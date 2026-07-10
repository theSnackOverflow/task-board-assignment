import { describe, expect, it, vi } from 'vitest'
import { flush, makeClient, makeTask, seqIdGen } from '../test/factories'
import { createTaskStore } from './taskStore'

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'

async function until(condition: () => boolean, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (condition()) return
    await flush()
  }
}

describe.skipIf(!hasBroadcastChannel)('다중 탭 동기화', () => {
  it('한 탭의 이동 성공이 다른 탭 캐시에 반영된다', async () => {
    const channel = `test-sync-move-${Math.random()}`
    const seed = [makeTask('a', { version: 1 })]
    const tabA = createTaskStore(
      makeClient({
        getTasks: vi.fn().mockResolvedValue(seed),
        updateTask: vi.fn().mockResolvedValue(makeTask('a', { status: 'done', version: 2 })),
      }),
      seqIdGen('a'),
      { syncChannel: channel },
    )
    const tabB = createTaskStore(
      makeClient({ getTasks: vi.fn().mockResolvedValue(seed) }),
      seqIdGen('b'),
      { syncChannel: channel },
    )
    await tabA.actions.loadTasks()
    await tabB.actions.loadTasks()

    tabA.actions.move('a', 'done')
    await until(() => tabB.getState().server.byId['a']?.status === 'done')

    expect(tabB.getState().server.byId['a']).toMatchObject({ status: 'done', version: 2 })

    tabA.dispose()
    tabB.dispose()
  })

  it('삭제 전파는 수신 탭에 진행 중 작업이 없을 때만 제거한다', async () => {
    const channel = `test-sync-remove-${Math.random()}`
    const seed = [makeTask('a'), makeTask('b')]
    const tabA = createTaskStore(
      makeClient({
        getTasks: vi.fn().mockResolvedValue(seed),
        deleteTask: vi.fn().mockResolvedValue(undefined),
      }),
      seqIdGen('a'),
      { syncChannel: channel },
    )
    const tabB = createTaskStore(
      makeClient({ getTasks: vi.fn().mockResolvedValue(seed) }),
      seqIdGen('b'),
      { syncChannel: channel },
    )
    await tabA.actions.loadTasks()
    await tabB.actions.loadTasks()

    tabA.actions.remove('a')
    await until(() => tabB.getState().server.byId['a'] === undefined)

    expect(tabB.getState().server.ids).toEqual(['b'])

    tabA.dispose()
    tabB.dispose()
  })
})
