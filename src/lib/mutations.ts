import type {
  CreateMutation,
  CreatePayload,
  Mutation,
  MutationState,
  ServerCache,
  Task,
} from '../types'

export const TEMP_ID_PREFIX = 'temp-'

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX)
}

export function buildTempTask(tempId: string, payload: CreatePayload): Task {
  return {
    id: tempId,
    title: payload.title,
    description: payload.description,
    status: payload.status,
    priority: payload.priority,
    tags: [],
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
    version: 0,
  }
}

export function applyPending(server: ServerCache, queue: Mutation[]): Task[] {
  const byId: Record<string, Task> = { ...server.byId }
  const createdIds: string[] = []
  for (const m of queue) {
    if (m.kind === 'create') {
      byId[m.taskId] = buildTempTask(m.taskId, m.payload)
      createdIds.unshift(m.taskId)
    } else if (m.kind === 'move') {
      const task = byId[m.taskId]
      if (task) byId[m.taskId] = { ...task, status: m.payload.status }
    } else if (m.kind === 'edit') {
      const task = byId[m.taskId]
      if (task) byId[m.taskId] = { ...task, ...m.payload }
    } else {
      delete byId[m.taskId]
    }
  }
  const result: Task[] = []
  for (const id of createdIds) {
    const task = byId[id]
    if (task) result.push(task)
  }
  for (const id of server.ids) {
    const task = byId[id]
    if (task) result.push(task)
  }
  return result
}

export function coalesce(queue: Mutation[], next: Mutation): Mutation[] {
  if (next.kind === 'delete') {
    const hasQueuedCreate = queue.some(
      (m) => m.taskId === next.taskId && m.kind === 'create' && m.state === 'queued',
    )
    const kept = queue.filter((m) => !(m.taskId === next.taskId && m.state === 'queued'))
    return hasQueuedCreate ? kept : [...kept, next]
  }
  if (next.kind === 'move' || next.kind === 'edit') {
    for (let i = queue.length - 1; i >= 0; i--) {
      const m = queue[i]
      if (m.taskId === next.taskId && m.kind === next.kind && m.state === 'queued') {
        const replaced = [...queue]
        replaced[i] = next
        return replaced
      }
    }
  }
  return [...queue, next]
}

export function confirmCreate(
  server: ServerCache,
  queue: Mutation[],
  mutation: CreateMutation,
  created: Task,
): { server: ServerCache; queue: Mutation[] } {
  const byId = { ...server.byId, [created.id]: created }
  const ids = [created.id, ...server.ids]
  const remapped = queue
    .filter((m) => m.localId !== mutation.localId)
    .map((m) => (m.taskId === mutation.taskId ? { ...m, taskId: created.id } : m))
  return { server: { ids, byId }, queue: remapped }
}

export function confirmUpdate(
  server: ServerCache,
  queue: Mutation[],
  localId: string,
  updated: Task,
): { server: ServerCache; queue: Mutation[] } {
  return {
    server: { ids: server.ids, byId: { ...server.byId, [updated.id]: updated } },
    queue: queue.filter((m) => m.localId !== localId),
  }
}

export function confirmDelete(
  server: ServerCache,
  queue: Mutation[],
  localId: string,
  taskId: string,
): { server: ServerCache; queue: Mutation[] } {
  const byId = { ...server.byId }
  delete byId[taskId]
  return {
    server: { ids: server.ids.filter((id) => id !== taskId), byId },
    queue: queue.filter((m) => m.localId !== localId),
  }
}

export function dropMutation(queue: Mutation[], localId: string): Mutation[] {
  return queue.filter((m) => m.localId !== localId)
}

export function sweepTask(queue: Mutation[], taskId: string): Mutation[] {
  return queue.filter((m) => m.taskId !== taskId)
}

export function setMutationState(
  queue: Mutation[],
  localId: string,
  state: MutationState,
): Mutation[] {
  return queue.map((m) => (m.localId === localId ? { ...m, state } : m))
}

export function bumpAttempts(queue: Mutation[], localId: string): Mutation[] {
  return queue.map((m) => (m.localId === localId ? { ...m, attempts: m.attempts + 1 } : m))
}

export function pendingTaskIds(queue: Mutation[]): Set<string> {
  return new Set(queue.map((m) => m.taskId))
}

export function mergeServer(
  cache: ServerCache,
  fetched: Task[],
  pendingIds: Set<string>,
): ServerCache {
  const byId: Record<string, Task> = {}
  const ids: string[] = []
  for (const task of fetched) {
    const existing = cache.byId[task.id]
    byId[task.id] = existing && existing.version > task.version ? existing : task
    ids.push(task.id)
  }
  for (const id of cache.ids) {
    if (!byId[id] && pendingIds.has(id) && cache.byId[id]) {
      byId[id] = cache.byId[id]
      ids.push(id)
    }
  }
  return { ids, byId }
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = 300 * Math.pow(3, attempt - 1)
  const jitter = base * 0.2 * (random() * 2 - 1)
  return Math.round(base + jitter)
}
