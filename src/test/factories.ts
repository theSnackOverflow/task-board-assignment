import { vi } from 'vitest'
import type { EngineClient } from '../store/engine'
import type { Task } from '../types'

export const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: 'todo',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  ...over,
})

export function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function seqIdGen(prefix = 'id') {
  let n = 0
  return () => `${prefix}-${++n}`
}

export function makeClient(over: Partial<EngineClient> = {}): EngineClient {
  return {
    getTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockRejectedValue(new Error('createTask 미설정')),
    updateTask: vi.fn().mockRejectedValue(new Error('updateTask 미설정')),
    deleteTask: vi.fn().mockRejectedValue(new Error('deleteTask 미설정')),
    ...over,
  }
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
