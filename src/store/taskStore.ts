import * as api from '../api/client'
import { coalesce, TEMP_ID_PREFIX } from '../lib/mutations'
import { appendToast } from '../lib/toasts'
import type {
  CreatePayload,
  EditPayload,
  Mutation,
  Priority,
  Status,
  StoreState,
  Task,
} from '../types'
import { createEngine, type EngineClient } from './engine'
import { createTabSync } from './sync'

export interface CreateInput {
  title: string
  priority: Priority
  description?: string
  status: Status
}

const initialState = (): StoreState => ({
  load: { status: 'idle', error: null },
  server: { ids: [], byId: {} },
  queue: [],
  paused: false,
  draggingId: null,
  toasts: [],
})

export function createTaskStore(
  client: EngineClient = api,
  genId: () => string = () => crypto.randomUUID(),
  options: { syncChannel?: string } = {},
) {
  let state = initialState()
  const listeners = new Set<() => void>()

  const getState = () => state

  function replaceState(updater: (s: StoreState) => StoreState) {
    state = updater(state)
    listeners.forEach((listener) => listener())
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function receiveUpsert(task: Task) {
    replaceState((s) => {
      const existing = s.server.byId[task.id]
      if (existing && existing.version >= task.version) return s
      const byId = { ...s.server.byId, [task.id]: task }
      const ids = existing ? s.server.ids : [task.id, ...s.server.ids]
      return { ...s, server: { ids, byId } }
    })
  }

  function receiveRemove(id: string) {
    replaceState((s) => {
      if (!s.server.byId[id]) return s
      if (s.queue.some((m) => m.taskId === id)) return s
      const byId = { ...s.server.byId }
      delete byId[id]
      return { ...s, server: { ids: s.server.ids.filter((x) => x !== id), byId } }
    })
  }

  const sync = createTabSync(options.syncChannel, {
    onUpsert: receiveUpsert,
    onRemove: receiveRemove,
  })

  const engine = createEngine({
    client,
    getState,
    replaceState,
    genId,
    reenqueue,
    broadcast: { upsert: sync.publishUpsert, remove: sync.publishRemove },
  })

  function reenqueue(mutation: Mutation) {
    if (mutation.kind === 'move') move(mutation.taskId, mutation.payload.status)
    else if (mutation.kind === 'edit') edit(mutation.taskId, mutation.payload)
    else if (mutation.kind === 'delete') remove(mutation.taskId)
    else enqueueCreate(mutation.payload)
  }

  function rejectWhenOffline(): boolean {
    if (!state.paused) return false
    replaceState((s) => ({
      ...s,
      toasts: appendToast(
        s.toasts,
        { kind: 'info', message: '오프라인 상태입니다. 연결 후 다시 시도해 주세요.' },
        genId(),
      ),
    }))
    return true
  }

  function enqueue(mutation: Mutation) {
    replaceState((s) => ({ ...s, queue: coalesce(s.queue, mutation) }))
    engine.kick()
  }

  async function loadTasks() {
    if (state.load.status === 'loading' || state.load.status === 'ready') return
    replaceState((s) => ({ ...s, load: { status: 'loading', error: null } }))
    try {
      const tasks = await client.getTasks()
      replaceState((s) => ({
        ...s,
        load: { status: 'ready', error: null },
        server: {
          ids: tasks.map((t) => t.id),
          byId: Object.fromEntries(tasks.map((t) => [t.id, t])),
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '요청에 실패했습니다.'
      replaceState((s) => ({ ...s, load: { status: 'error', error: message } }))
    }
  }

  function retryLoad() {
    if (state.load.status !== 'error') return
    replaceState((s) => ({ ...s, load: { status: 'idle', error: null } }))
    void loadTasks()
  }

  function effectiveStatus(taskId: string): Status | undefined {
    let status: Status | undefined = state.server.byId[taskId]?.status
    for (const m of state.queue) {
      if (m.taskId !== taskId) continue
      if (m.kind === 'move' || m.kind === 'create') status = m.payload.status
      else if (m.kind === 'delete') status = undefined
    }
    return status
  }

  function move(taskId: string, status: Status) {
    if (rejectWhenOffline()) return
    const current = effectiveStatus(taskId)
    if (current === undefined || current === status) return
    enqueue({ localId: genId(), taskId, kind: 'move', payload: { status }, state: 'queued', attempts: 0 })
  }

  function edit(taskId: string, payload: EditPayload) {
    if (rejectWhenOffline()) return
    enqueue({ localId: genId(), taskId, kind: 'edit', payload, state: 'queued', attempts: 0 })
  }

  function create(input: CreateInput) {
    enqueueCreate({ ...input, createdAt: new Date().toISOString() })
  }

  function enqueueCreate(payload: CreatePayload) {
    if (rejectWhenOffline()) return
    enqueue({
      localId: genId(),
      taskId: `${TEMP_ID_PREFIX}${genId()}`,
      kind: 'create',
      payload,
      state: 'queued',
      attempts: 0,
    })
  }

  function remove(taskId: string) {
    if (rejectWhenOffline()) return
    engine.cancelRetriesFor(taskId)
    enqueue({ localId: genId(), taskId, kind: 'delete', state: 'queued', attempts: 0 })
  }

  function dismissToast(id: string) {
    replaceState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }))
  }

  function setDragging(taskId: string | null) {
    if (state.draggingId === taskId) return
    replaceState((s) => ({ ...s, draggingId: taskId }))
  }

  function goOffline() {
    engine.pause()
  }

  function goOnline() {
    engine.resume()
  }

  return {
    getState,
    subscribe,
    actions: {
      loadTasks,
      retryLoad,
      move,
      edit,
      create,
      remove,
      dismissToast,
      setDragging,
      goOffline,
      goOnline,
    },
    dispose: () => {
      engine.dispose()
      sync.dispose()
    },
  }
}

export type TaskStore = ReturnType<typeof createTaskStore>

export const taskStore = createTaskStore(api, () => crypto.randomUUID(), {
  syncChannel: 'taskboard-sync',
})
