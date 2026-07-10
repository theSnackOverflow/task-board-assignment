export type Status = 'todo' | 'in-progress' | 'done'
export type Priority = 'high' | 'medium' | 'low'

export interface Task {
  id: string
  title: string
  description?: string
  status: Status
  priority: Priority
  tags?: string[]
  assignee?: string
  createdAt: string // ISO
  updatedAt: string // ISO
  /** 낙관적 동시성 제어용. PATCH 시 이 값을 함께 보내야 하며, 서버 값과 다르면 409. */
  version: number
}

export type MovePayload = { status: Status }

export type EditPayload = {
  title: string
  priority: Priority
  description?: string
}

export type CreatePayload = {
  title: string
  priority: Priority
  description?: string
  status: Status
  createdAt: string
}

export type MutationState = 'queued' | 'inflight'

interface MutationBase {
  localId: string
  taskId: string
  state: MutationState
  attempts: number
}

export interface MoveMutation extends MutationBase {
  kind: 'move'
  payload: MovePayload
}

export interface EditMutation extends MutationBase {
  kind: 'edit'
  payload: EditPayload
}

export interface CreateMutation extends MutationBase {
  kind: 'create'
  payload: CreatePayload
}

export interface DeleteMutation extends MutationBase {
  kind: 'delete'
}

export type Mutation = MoveMutation | EditMutation | CreateMutation | DeleteMutation

export type PendingKind = Mutation['kind']

export interface ServerCache {
  ids: string[]
  byId: Record<string, Task>
}

export type LoadStatus = 'idle' | 'loading' | 'error' | 'ready'

export interface ToastItem {
  id: string
  kind: 'info' | 'error'
  message: string
  sticky?: boolean
  action?: { label: string; run: () => void }
}

export interface StoreState {
  load: { status: LoadStatus; error: string | null }
  server: ServerCache
  queue: Mutation[]
  paused: boolean
  draggingId: string | null
  toasts: ToastItem[]
}
