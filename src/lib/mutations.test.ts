import { describe, expect, it } from 'vitest'
import type {
  CreateMutation,
  DeleteMutation,
  EditMutation,
  MoveMutation,
  MutationState,
  ServerCache,
  Status,
  Task,
} from '../types'
import {
  applyPending,
  backoffDelay,
  coalesce,
  confirmCreate,
  confirmDelete,
  confirmUpdate,
  mergeServer,
  pendingTaskIds,
  sweepTask,
} from './mutations'

const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: 'todo',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  ...over,
})

const makeServer = (...tasks: Task[]): ServerCache => ({
  ids: tasks.map((t) => t.id),
  byId: Object.fromEntries(tasks.map((t) => [t.id, t])),
})

let seq = 0
const nextId = () => `m${++seq}`

const move = (taskId: string, status: Status, state: MutationState = 'queued'): MoveMutation => ({
  localId: nextId(),
  taskId,
  kind: 'move',
  payload: { status },
  state,
  attempts: 0,
})

const edit = (taskId: string, title: string, state: MutationState = 'queued'): EditMutation => ({
  localId: nextId(),
  taskId,
  kind: 'edit',
  payload: { title, priority: 'high' },
  state,
  attempts: 0,
})

const create = (tempId: string, state: MutationState = 'queued'): CreateMutation => ({
  localId: nextId(),
  taskId: tempId,
  kind: 'create',
  payload: {
    title: `New ${tempId}`,
    priority: 'low',
    status: 'todo',
    createdAt: '2026-07-10T00:00:00.000Z',
  },
  state,
  attempts: 0,
})

const del = (taskId: string, state: MutationState = 'queued'): DeleteMutation => ({
  localId: nextId(),
  taskId,
  kind: 'delete',
  state,
  attempts: 0,
})

describe('coalesce', () => {
  it('같은 태스크의 queued move는 마지막 것으로 교체한다', () => {
    const queue = coalesce([move('a', 'in-progress')], move('a', 'done'))
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ kind: 'move', payload: { status: 'done' } })
  })

  it('inflight 뮤테이션은 교체하지 않고 뒤에 추가한다', () => {
    const inflight = move('a', 'in-progress', 'inflight')
    const queue = coalesce([inflight], move('a', 'done'))
    expect(queue).toHaveLength(2)
    expect(queue[0]).toBe(inflight)
  })

  it('kind가 다르면 교체하지 않고 순서를 유지한다', () => {
    const first = move('a', 'in-progress')
    const second = edit('a', '새 제목')
    const queue = coalesce(coalesce([first], second), move('a', 'done'))
    expect(queue.map((m) => m.kind)).toEqual(['move', 'edit'])
    expect(queue[0]).toMatchObject({ payload: { status: 'done' } })
  })

  it('같은 태스크의 queued edit는 마지막 것으로 교체한다', () => {
    const queue = coalesce([edit('a', '제목1')], edit('a', '제목2'))
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ payload: { title: '제목2' } })
  })

  it('delete는 같은 태스크의 queued 뮤테이션을 청소하고 맨 뒤에 선다', () => {
    const inflight = move('a', 'in-progress', 'inflight')
    const queue = coalesce([inflight, move('a', 'done'), edit('a', '제목')], del('a'))
    expect(queue.map((m) => m.kind)).toEqual(['move', 'delete'])
    expect(queue[0]).toBe(inflight)
  })

  it('queued create가 있으면 delete와 서로 상쇄된다', () => {
    const queue = coalesce([create('temp-1'), move('temp-1', 'done')], del('temp-1'))
    expect(queue).toHaveLength(0)
  })

  it('다른 태스크의 뮤테이션에는 영향을 주지 않는다', () => {
    const other = move('b', 'done')
    const queue = coalesce([other], move('a', 'done'))
    expect(queue).toHaveLength(2)
    expect(queue[0]).toBe(other)
  })
})

describe('applyPending', () => {
  it('빈 큐면 서버 순서 그대로 반환한다', () => {
    const server = makeServer(makeTask('a'), makeTask('b'))
    expect(applyPending(server, []).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('pending move가 상태를 덮어쓰고 원본은 불변이다', () => {
    const server = makeServer(makeTask('a'))
    const view = applyPending(server, [move('a', 'done')])
    expect(view[0].status).toBe('done')
    expect(server.byId['a'].status).toBe('todo')
  })

  it('pending edit는 콘텐츠 필드만 바꾸고 version은 서버 값을 유지한다', () => {
    const server = makeServer(makeTask('a', { version: 7 }))
    const view = applyPending(server, [edit('a', '바뀐 제목')])
    expect(view[0].title).toBe('바뀐 제목')
    expect(view[0].priority).toBe('high')
    expect(view[0].version).toBe(7)
  })

  it('pending delete는 목록에서 제외한다', () => {
    const server = makeServer(makeTask('a'), makeTask('b'))
    const view = applyPending(server, [del('a')])
    expect(view.map((t) => t.id)).toEqual(['b'])
  })

  it('pending create는 임시 태스크를 맨 앞에 추가한다', () => {
    const server = makeServer(makeTask('a'))
    const view = applyPending(server, [create('temp-1')])
    expect(view.map((t) => t.id)).toEqual(['temp-1', 'a'])
    expect(view[0].version).toBe(0)
  })

  it('임시 태스크에 걸린 move도 반영된다', () => {
    const view = applyPending(makeServer(), [create('temp-1'), move('temp-1', 'done')])
    expect(view[0].status).toBe('done')
  })

  it('서버에 없는 태스크의 move는 조용히 무시한다', () => {
    const server = makeServer(makeTask('a'))
    expect(applyPending(server, [move('ghost', 'done')])).toHaveLength(1)
  })

  it('같은 태스크의 move와 edit가 함께 반영된다', () => {
    const server = makeServer(makeTask('a'))
    const view = applyPending(server, [move('a', 'done'), edit('a', '제목')])
    expect(view[0]).toMatchObject({ status: 'done', title: '제목' })
  })
})

describe('confirmCreate', () => {
  it('서버 태스크를 맨 앞에 넣고 큐의 tempId 참조를 리매핑한다', () => {
    const server = makeServer(makeTask('a'))
    const mutation = create('temp-1', 'inflight')
    const queue = [mutation, move('temp-1', 'done'), move('a', 'done')]
    const created = makeTask('real-1', { version: 1 })
    const result = confirmCreate(server, queue, mutation, created)
    expect(result.server.ids).toEqual(['real-1', 'a'])
    expect(result.queue.map((m) => m.taskId)).toEqual(['real-1', 'a'])
  })
})

describe('confirmUpdate', () => {
  it('서버 응답으로 캐시를 갱신하고 해당 뮤테이션을 제거한다', () => {
    const server = makeServer(makeTask('a', { version: 1 }))
    const mutation = move('a', 'done', 'inflight')
    const updated = makeTask('a', { status: 'done', version: 2 })
    const result = confirmUpdate(server, [mutation], mutation.localId, updated)
    expect(result.server.byId['a'].version).toBe(2)
    expect(result.queue).toHaveLength(0)
  })
})

describe('confirmDelete', () => {
  it('캐시와 ids에서 제거하고 해당 뮤테이션을 제거한다', () => {
    const server = makeServer(makeTask('a'), makeTask('b'))
    const mutation = del('a', 'inflight')
    const result = confirmDelete(server, [mutation], mutation.localId, 'a')
    expect(result.server.ids).toEqual(['b'])
    expect(result.server.byId['a']).toBeUndefined()
    expect(result.queue).toHaveLength(0)
  })
})

describe('sweepTask', () => {
  it('해당 태스크의 뮤테이션을 전부 제거한다 (고아 정리)', () => {
    const queue = [move('temp-1', 'done'), del('temp-1'), move('b', 'done')]
    const swept = sweepTask(queue, 'temp-1')
    expect(swept.map((m) => m.taskId)).toEqual(['b'])
  })
})

describe('pendingTaskIds', () => {
  it('큐에 있는 태스크 id 집합을 반환한다', () => {
    const ids = pendingTaskIds([move('a', 'done'), del('b')])
    expect(ids).toEqual(new Set(['a', 'b']))
  })
})

describe('mergeServer', () => {
  it('fetched의 version이 높으면 fetched를 채택한다', () => {
    const cache = makeServer(makeTask('a', { version: 1 }))
    const merged = mergeServer(cache, [makeTask('a', { version: 3, status: 'done' })], new Set())
    expect(merged.byId['a']).toMatchObject({ version: 3, status: 'done' })
  })

  it('캐시의 version이 높으면 오래된 fetched가 덮어쓰지 못한다', () => {
    const cache = makeServer(makeTask('a', { version: 5, status: 'done' }))
    const merged = mergeServer(cache, [makeTask('a', { version: 4 })], new Set())
    expect(merged.byId['a']).toMatchObject({ version: 5, status: 'done' })
  })

  it('fetched에 없고 pending도 없는 id는 제거한다', () => {
    const cache = makeServer(makeTask('a'), makeTask('b'))
    const merged = mergeServer(cache, [makeTask('a')], new Set())
    expect(merged.ids).toEqual(['a'])
  })

  it('fetched에 없어도 pending이 있으면 보존한다', () => {
    const cache = makeServer(makeTask('a'), makeTask('b'))
    const merged = mergeServer(cache, [makeTask('a')], new Set(['b']))
    expect(merged.ids).toEqual(['a', 'b'])
    expect(merged.byId['b']).toBeDefined()
  })
})

describe('backoffDelay', () => {
  it('1회차는 300ms, 2회차는 900ms 기준으로 지수 증가한다', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(300)
    expect(backoffDelay(2, () => 0.5)).toBe(900)
  })

  it('jitter는 기준값의 20% 이내다', () => {
    expect(backoffDelay(1, () => 1)).toBe(360)
    expect(backoffDelay(1, () => 0)).toBe(240)
  })
})
