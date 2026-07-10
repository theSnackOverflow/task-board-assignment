import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
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

describe('생성 흐름 - tempId 리매핑과 고아 정리', () => {
  it('생성 확정 전의 이동은 대기했다가 서버 id로 리매핑되어 전송된다', async () => {
    const dCreate = defer<Task>()
    const createTask = vi.fn().mockReturnValue(dCreate.promise)
    const updateTask = vi.fn().mockResolvedValue(makeTask('real-1', { status: 'done', version: 2 }))
    const { store } = storeWithTasks([], { createTask, updateTask })
    await store.actions.loadTasks()

    store.actions.create({ title: '새 태스크', priority: 'high', status: 'todo' })
    const tempId = store.getState().queue[0].taskId
    store.actions.move(tempId, 'done')

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(updateTask).not.toHaveBeenCalled()

    dCreate.resolve(makeTask('real-1', { title: '새 태스크', version: 1 }))
    await flush()

    expect(updateTask).toHaveBeenCalledWith('real-1', { status: 'done', version: 1 })
    expect(store.getState().server.ids[0]).toBe('real-1')
  })

  it('생성이 최종 실패하면 그 태스크를 참조하던 대기 뮤테이션도 함께 정리된다', async () => {
    vi.useFakeTimers()
    try {
      const createTask = vi.fn().mockRejectedValue(new Error('일시적인 서버 오류'))
      const updateTask = vi.fn()
      const { store } = storeWithTasks([], { createTask, updateTask })
      await store.actions.loadTasks()

      store.actions.create({ title: '새 태스크', priority: 'high', status: 'todo' })
      const tempId = store.getState().queue[0].taskId
      store.actions.move(tempId, 'done')
      expect(store.getState().queue).toHaveLength(2)

      await vi.runAllTimersAsync()

      expect(store.getState().queue).toHaveLength(0)
      expect(updateTask).not.toHaveBeenCalled()
      expect(store.getState().toasts.some((t) => t.message.includes('생성에 실패'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('409 충돌 처리', () => {
  const conflict = (current: Task) =>
    new ApiError(409, '다른 곳에서 먼저 수정되었습니다.', { current })

  it('409를 받으면 서버 최신 상태를 반영하고, 재적용은 그 시점의 version으로 나간다', async () => {
    const current = makeTask('a', { title: '서버 제목', status: 'in-progress', version: 5 })
    const updateTask = vi
      .fn()
      .mockRejectedValueOnce(conflict(current))
      .mockResolvedValueOnce(makeTask('a', { status: 'done', version: 6 }))
    const { store } = storeWithTasks([makeTask('a', { version: 1 })], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'done')
    await flush()

    expect(store.getState().server.byId['a']).toMatchObject({ status: 'in-progress', version: 5 })
    expect(store.getState().queue).toHaveLength(0)
    const toast = store.getState().toasts.find((t) => t.action)
    expect(toast?.message).toContain('다른 곳에서 먼저 수정')

    toast?.action?.run()
    await flush()

    expect(updateTask).toHaveBeenNthCalledWith(2, 'a', { status: 'done', version: 5 })
    expect(store.getState().server.byId['a'].status).toBe('done')
  })

  it('같은 태스크에서 충돌이 3회 누적되면 재적용 버튼 없이 안내만 띄운다', async () => {
    const updateTask = vi
      .fn()
      .mockRejectedValueOnce(conflict(makeTask('a', { version: 2 })))
      .mockRejectedValueOnce(conflict(makeTask('a', { version: 3 })))
      .mockRejectedValueOnce(conflict(makeTask('a', { version: 4 })))
    const { store } = storeWithTasks([makeTask('a', { version: 1 })], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'done')
    await flush()
    let toasts = store.getState().toasts
    toasts[toasts.length - 1].action?.run()
    await flush()
    toasts = store.getState().toasts
    toasts[toasts.length - 1].action?.run()
    await flush()

    toasts = store.getState().toasts
    const last = toasts[toasts.length - 1]
    expect(updateTask).toHaveBeenCalledTimes(3)
    expect(last.action).toBeUndefined()
    expect(last.message).toContain('반복')
  })
})

describe('404 태스크 소멸 처리', () => {
  it('404를 받으면 태스크를 캐시와 큐에서 정리하고 안내 토스트를 띄운다', async () => {
    const updateTask = vi
      .fn()
      .mockRejectedValue(new ApiError(404, '태스크를 찾을 수 없습니다.', null))
    const { store } = storeWithTasks([makeTask('a'), makeTask('b')], { updateTask })
    await store.actions.loadTasks()

    store.actions.move('a', 'done')
    await flush()

    expect(store.getState().server.byId['a']).toBeUndefined()
    expect(store.getState().server.ids).toEqual(['b'])
    expect(store.getState().queue).toHaveLength(0)
    expect(store.getState().toasts.some((t) => t.message.includes('이미 삭제된'))).toBe(true)
  })
})

describe('네트워크 단절과 재개', () => {
  it('TypeError는 재시도 예산을 소모하지 않고 엔진을 멈추며, 재개 시 재전송 후 재동기화한다', async () => {
    const getTasks = vi.fn().mockResolvedValue([makeTask('a', { version: 1 })])
    const updateTask = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeTask('a', { status: 'done', version: 2 }))
    const store = createTaskStore(makeClient({ getTasks, updateTask }), seqIdGen())
    await store.actions.loadTasks()

    store.actions.move('a', 'done')
    await flush()

    expect(store.getState().paused).toBe(true)
    expect(store.getState().queue[0]).toMatchObject({ state: 'queued', attempts: 0 })
    expect(store.getState().server.byId['a'].status).toBe('todo')

    store.actions.goOnline()
    await flush()
    await flush()

    expect(updateTask).toHaveBeenCalledTimes(2)
    expect(store.getState().server.byId['a'].status).toBe('done')
    expect(store.getState().queue).toHaveLength(0)
    expect(getTasks).toHaveBeenCalledTimes(2)
  })

  it('오프라인 중 신규 쓰기는 큐에 넣지 않고 토스트로 거부한다', async () => {
    const { store } = storeWithTasks([makeTask('a')])
    await store.actions.loadTasks()

    store.actions.goOffline()
    store.actions.move('a', 'done')

    expect(store.getState().queue).toHaveLength(0)
    expect(store.getState().toasts.some((t) => t.message.includes('오프라인'))).toBe(true)
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
