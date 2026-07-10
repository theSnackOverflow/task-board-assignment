import { describe, expect, it, vi } from 'vitest'
import { defer, flush, makeClient, makeTask, seqIdGen } from '../test/factories'
import type { Task } from '../types'
import { createTaskStore } from './taskStore'

function storeWithTasks(tasks: Task[], clientOver: Parameters<typeof makeClient>[0] = {}) {
  const client = makeClient({ getTasks: vi.fn().mockResolvedValue(tasks), ...clientOver })
  const store = createTaskStore(client, seqIdGen())
  return { client, store }
}

describe('엔진 직렬화와 version 체이닝', () => {
  it('같은 태스크의 두 번째 이동은 첫 응답이 올 때까지 전송되지 않는다', async () => {
    const d1 = defer<Task>()
    const d2 = defer<Task>()
    const updateTask = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
    const { store } = storeWithTasks([makeTask('a', { version: 1 })], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'in-progress')
    store.actions.move('a', 'done')

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(updateTask).toHaveBeenNthCalledWith(1, 'a', { status: 'in-progress', version: 1 })

    d1.resolve(makeTask('a', { status: 'in-progress', version: 2 }))
    await flush()

    expect(updateTask).toHaveBeenCalledTimes(2)
    expect(updateTask).toHaveBeenNthCalledWith(2, 'a', { status: 'done', version: 2 })

    d2.resolve(makeTask('a', { status: 'done', version: 3 }))
    await flush()

    expect(store.getState().server.byId['a'].status).toBe('done')
    expect(store.getState().queue).toHaveLength(0)
  })

  it('연속 이동은 coalescing으로 요청 2개로 수렴하고 최종 상태가 서버에 반영된다', async () => {
    const d1 = defer<Task>()
    const d2 = defer<Task>()
    const updateTask = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
    const { store } = storeWithTasks([makeTask('a', { version: 1 })], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'in-progress')
    store.actions.move('a', 'done')
    store.actions.move('a', 'todo')

    d1.resolve(makeTask('a', { status: 'in-progress', version: 2 }))
    await flush()
    d2.resolve(makeTask('a', { status: 'todo', version: 3 }))
    await flush()

    expect(updateTask).toHaveBeenCalledTimes(2)
    expect(updateTask).toHaveBeenNthCalledWith(2, 'a', { status: 'todo', version: 2 })
    expect(store.getState().server.byId['a'].status).toBe('todo')
  })

  it('다른 태스크의 이동은 병렬로 전송된다', async () => {
    const d1 = defer<Task>()
    const d2 = defer<Task>()
    const updateTask = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
    const { store } = storeWithTasks(
      [makeTask('a', { version: 1 }), makeTask('b', { version: 1 })],
      { updateTask },
    )
    await store.actions.loadTasks()

    store.actions.move('a', 'done')
    store.actions.move('b', 'done')

    expect(updateTask).toHaveBeenCalledTimes(2)
  })

  it('현재 상태와 같은 컬럼으로의 이동은 요청을 만들지 않는다', async () => {
    const updateTask = vi.fn()
    const { store } = storeWithTasks([makeTask('a')], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'todo')

    expect(updateTask).not.toHaveBeenCalled()
    expect(store.getState().queue).toHaveLength(0)
  })
})

describe('낙관 반영과 롤백', () => {
  it('이동은 응답 전에 화면에 반영되고 최종 실패 시 원래 상태로 돌아온다', async () => {
    vi.useFakeTimers()
    try {
      const updateTask = vi.fn().mockRejectedValue(new Error('일시적인 서버 오류'))
      const failing = makeClient({
        getTasks: vi.fn().mockResolvedValue([makeTask('a')]),
        updateTask,
      })
      const store = createTaskStore(failing, seqIdGen())
      await store.actions.loadTasks()

      store.actions.move('a', 'done')
      expect(store.getState().queue).toHaveLength(1)

      await vi.runAllTimersAsync()

      expect(store.getState().queue).toHaveLength(0)
      expect(store.getState().server.byId['a'].status).toBe('todo')
      expect(store.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('자동 재시도와 백오프', () => {
  it('일시 실패는 지수 백오프로 2회 재시도하고 성공하면 토스트 없이 확정된다', async () => {
    vi.useFakeTimers()
    try {
      const updateTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('일시적인 서버 오류'))
        .mockRejectedValueOnce(new Error('일시적인 서버 오류'))
        .mockResolvedValueOnce(makeTask('a', { status: 'done', version: 2 }))
      const store = createTaskStore(
        makeClient({ getTasks: vi.fn().mockResolvedValue([makeTask('a')]), updateTask }),
        seqIdGen(),
      )
      await store.actions.loadTasks()

      store.actions.move('a', 'done')
      await vi.advanceTimersByTimeAsync(0)
      expect(updateTask).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(400)
      expect(updateTask).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1100)
      expect(updateTask).toHaveBeenCalledTimes(3)

      expect(store.getState().server.byId['a'].status).toBe('done')
      expect(store.getState().toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('재시도 중인 이동 뒤에 삭제가 대기하면 재시도를 생략하고 삭제를 진행한다', async () => {
    vi.useFakeTimers()
    try {
      const d1 = defer<Task>()
      const updateTask = vi.fn().mockReturnValueOnce(d1.promise)
      const deleteTask = vi.fn().mockResolvedValue(undefined)
      const store = createTaskStore(
        makeClient({
          getTasks: vi.fn().mockResolvedValue([makeTask('a')]),
          updateTask,
          deleteTask,
        }),
        seqIdGen(),
      )
      await store.actions.loadTasks()

      store.actions.move('a', 'done')
      store.actions.remove('a')
      expect(store.getState().queue.map((m) => m.kind)).toEqual(['move', 'delete'])

      d1.reject(new Error('일시적인 서버 오류'))
      await vi.runAllTimersAsync()

      expect(updateTask).toHaveBeenCalledTimes(1)
      expect(deleteTask).toHaveBeenCalledWith('a')
      expect(store.getState().server.byId['a']).toBeUndefined()
      expect(store.getState().toasts.filter((t) => t.kind === 'error')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('백오프 타이머 대기 중 삭제가 들어오면 타이머를 취소하고 삭제를 진행한다', async () => {
    vi.useFakeTimers()
    try {
      const updateTask = vi.fn().mockRejectedValue(new Error('일시적인 서버 오류'))
      const deleteTask = vi.fn().mockResolvedValue(undefined)
      const store = createTaskStore(
        makeClient({
          getTasks: vi.fn().mockResolvedValue([makeTask('a')]),
          updateTask,
          deleteTask,
        }),
        seqIdGen(),
      )
      await store.actions.loadTasks()

      store.actions.move('a', 'done')
      await vi.advanceTimersByTimeAsync(0)
      expect(updateTask).toHaveBeenCalledTimes(1)

      store.actions.remove('a')
      await vi.runAllTimersAsync()

      expect(updateTask).toHaveBeenCalledTimes(1)
      expect(deleteTask).toHaveBeenCalledWith('a')
      expect(store.getState().queue).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
