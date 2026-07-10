import { ApiError } from '../api/client'
import {
  backoffDelay,
  bumpAttempts,
  confirmCreate,
  confirmDelete,
  confirmUpdate,
  dropMutation,
  mergeServer,
  pendingTaskIds,
  setMutationState,
  sweepTask,
} from '../lib/mutations'
import { appendToast } from '../lib/toasts'
import type { Mutation, StoreState, Task, ToastItem } from '../types'

export interface EngineClient {
  getTasks(signal?: AbortSignal): Promise<Task[]>
  createTask(input: Partial<Task>): Promise<Task>
  updateTask(id: string, patch: Partial<Task> & { version: number }): Promise<Task>
  deleteTask(id: string): Promise<void>
}

interface EngineDeps {
  client: EngineClient
  getState: () => StoreState
  replaceState: (updater: (state: StoreState) => StoreState) => void
  genId: () => string
  reenqueue: (mutation: Mutation) => void
}

const MAX_AUTO_RETRIES = 2
const CONFLICT_GIVE_UP_AT = 3

const ACTION_LABEL: Record<Mutation['kind'], string> = {
  move: '이동',
  edit: '수정',
  delete: '삭제',
  create: '생성',
}

export function createEngine(deps: EngineDeps) {
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const conflictCounts = new Map<string, number>()
  let resyncPending = false

  function pushToast(toasts: ToastItem[], input: Omit<ToastItem, 'id'>): ToastItem[] {
    return appendToast(toasts, input, deps.genId())
  }

  function taskTitle(mutation: Mutation): string {
    const cached = deps.getState().server.byId[mutation.taskId]
    if (cached) return cached.title
    if (mutation.kind === 'create' || mutation.kind === 'edit') return mutation.payload.title
    return '태스크'
  }

  function findMutation(localId: string): Mutation | undefined {
    return deps.getState().queue.find((m) => m.localId === localId)
  }

  function kick() {
    const state = deps.getState()
    if (state.paused) return
    if (state.queue.length === 0) {
      if (resyncPending) {
        resyncPending = false
        void resync()
      }
      return
    }
    const busy = new Set<string>()
    for (const m of state.queue) {
      if (m.state === 'inflight') busy.add(m.taskId)
    }
    for (const m of state.queue) {
      if (m.state !== 'queued' || busy.has(m.taskId)) continue
      busy.add(m.taskId)
      void run(m.localId)
    }
  }

  async function run(localId: string) {
    deps.replaceState((s) => ({ ...s, queue: setMutationState(s.queue, localId, 'inflight') }))
    await send(localId)
  }

  async function send(localId: string) {
    const mutation = findMutation(localId)
    if (!mutation) {
      kick()
      return
    }
    try {
      if (mutation.kind === 'create') {
        const created = await deps.client.createTask({
          title: mutation.payload.title,
          priority: mutation.payload.priority,
          description: mutation.payload.description,
          status: mutation.payload.status,
        })
        deps.replaceState((s) => {
          const result = confirmCreate(s.server, s.queue, mutation, created)
          return { ...s, server: result.server, queue: result.queue }
        })
      } else if (mutation.kind === 'move' || mutation.kind === 'edit') {
        const base = deps.getState().server.byId[mutation.taskId]
        if (!base) {
          deps.replaceState((s) => ({ ...s, queue: dropMutation(s.queue, localId) }))
        } else {
          const updated = await deps.client.updateTask(mutation.taskId, {
            ...mutation.payload,
            version: base.version,
          })
          conflictCounts.delete(mutation.taskId)
          deps.replaceState((s) => {
            const result = confirmUpdate(s.server, s.queue, localId, updated)
            return { ...s, server: result.server, queue: result.queue }
          })
        }
      } else {
        await deps.client.deleteTask(mutation.taskId)
        deps.replaceState((s) => {
          const result = confirmDelete(s.server, s.queue, localId, mutation.taskId)
          return { ...s, server: result.server, queue: result.queue }
        })
      }
    } catch (error) {
      handleFailure(mutation, error)
    } finally {
      kick()
    }
  }

  function handleFailure(mutation: Mutation, error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        handleConflict(mutation, error)
        return
      }
      if (error.status === 404) {
        handleGone(mutation)
        return
      }
      handleServerError(mutation)
      return
    }
    if (error instanceof TypeError) {
      deps.replaceState((s) => ({
        ...s,
        paused: true,
        queue: setMutationState(s.queue, mutation.localId, 'queued'),
      }))
      return
    }
    handleServerError(mutation)
  }

  function handleConflict(mutation: Mutation, error: ApiError) {
    const { localId, taskId } = mutation
    const current = (error.payload as { current?: Task } | null)?.current
    const count = (conflictCounts.get(taskId) ?? 0) + 1
    conflictCounts.set(taskId, count)
    const title = taskTitle(mutation)
    deps.replaceState((s) => {
      const byId = current ? { ...s.server.byId, [taskId]: current } : s.server.byId
      const toast: Omit<ToastItem, 'id'> =
        count >= CONFLICT_GIVE_UP_AT
          ? {
              kind: 'error',
              sticky: true,
              message: `'${title}'에 충돌이 반복되고 있습니다. 최신 상태를 확인해 주세요.`,
            }
          : {
              kind: 'error',
              sticky: true,
              message: `'${title}'이(가) 다른 곳에서 먼저 수정되어 서버 상태로 갱신했습니다.`,
              action: { label: '내 변경 다시 적용', run: () => deps.reenqueue(mutation) },
            }
      return {
        ...s,
        server: { ids: s.server.ids, byId },
        queue: dropMutation(s.queue, localId),
        toasts: pushToast(s.toasts, toast),
      }
    })
  }

  function handleGone(mutation: Mutation) {
    const { taskId } = mutation
    deps.replaceState((s) => {
      const byId = { ...s.server.byId }
      delete byId[taskId]
      return {
        ...s,
        server: { ids: s.server.ids.filter((id) => id !== taskId), byId },
        queue: sweepTask(s.queue, taskId),
        toasts: pushToast(s.toasts, { kind: 'info', message: '이미 삭제된 태스크입니다.' }),
      }
    })
  }

  function handleServerError(mutation: Mutation) {
    const { localId, taskId } = mutation
    const supersededByDelete = deps
      .getState()
      .queue.some((m) => m.taskId === taskId && m.kind === 'delete' && m.state === 'queued')
    if (supersededByDelete) {
      deps.replaceState((s) => ({ ...s, queue: dropMutation(s.queue, localId) }))
      return
    }
    if (mutation.attempts < MAX_AUTO_RETRIES) {
      deps.replaceState((s) => ({ ...s, queue: bumpAttempts(s.queue, localId) }))
      const timer = setTimeout(() => {
        retryTimers.delete(localId)
        void send(localId)
      }, backoffDelay(mutation.attempts + 1))
      retryTimers.set(localId, timer)
      return
    }
    deps.replaceState((s) => ({
      ...s,
      queue: mutation.kind === 'create' ? sweepTask(s.queue, taskId) : dropMutation(s.queue, localId),
      toasts: pushToast(s.toasts, {
        kind: 'error',
        sticky: true,
        message: `'${taskTitle(mutation)}' ${ACTION_LABEL[mutation.kind]}에 실패했습니다.`,
        action: { label: '다시 시도', run: () => deps.reenqueue(mutation) },
      }),
    }))
  }

  async function resync() {
    try {
      const tasks = await deps.client.getTasks()
      deps.replaceState((s) => ({
        ...s,
        server: mergeServer(s.server, tasks, pendingTaskIds(s.queue)),
      }))
    } catch {
      deps.replaceState((s) => ({
        ...s,
        toasts: pushToast(s.toasts, { kind: 'error', message: '서버와 동기화하지 못했습니다.' }),
      }))
    }
  }

  function pause() {
    deps.replaceState((s) => (s.paused ? s : { ...s, paused: true }))
  }

  function resume() {
    if (!deps.getState().paused) return
    resyncPending = true
    deps.replaceState((s) => ({ ...s, paused: false }))
    kick()
  }

  function cancelRetriesFor(taskId: string) {
    for (const m of deps.getState().queue) {
      if (m.taskId !== taskId) continue
      const timer = retryTimers.get(m.localId)
      if (timer === undefined) continue
      clearTimeout(timer)
      retryTimers.delete(m.localId)
      deps.replaceState((s) => ({ ...s, queue: dropMutation(s.queue, m.localId) }))
    }
  }

  function dispose() {
    retryTimers.forEach((timer) => clearTimeout(timer))
    retryTimers.clear()
  }

  return { kick, pause, resume, cancelRetriesFor, dispose }
}
