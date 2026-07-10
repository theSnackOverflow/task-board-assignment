import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api/client'
import Board from './Board'
import { StoreProvider } from './hooks/useTasks'
import { createTaskStore } from './store/taskStore'
import { makeClient, makeTask, seqIdGen } from './test/factories'

function renderBoard(client: ReturnType<typeof makeClient>) {
  const store = createTaskStore(client, seqIdGen())
  return { store, ...render(<StoreProvider value={store}><Board /></StoreProvider>) }
}

describe('Board 로드 상태', () => {
  it('로딩 중 스켈레톤을 보여주고 성공하면 카드를 렌더한다', async () => {
    const client = makeClient({
      getTasks: vi.fn().mockResolvedValue([makeTask('a', { title: '첫 태스크' })]),
    })
    renderBoard(client)
    expect(screen.getByLabelText('불러오는 중')).toBeInTheDocument()
    expect(await screen.findByText('첫 태스크')).toBeInTheDocument()
  })

  it('로드 실패 시 에러와 재시도 버튼을 보여주고 재시도가 동작한다', async () => {
    const getTasks = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, '일시적인 서버 오류입니다. 다시 시도해 주세요.', null))
      .mockResolvedValueOnce([makeTask('a', { title: '복구된 태스크' })])
    renderBoard(makeClient({ getTasks }))
    expect(await screen.findByRole('alert')).toHaveTextContent('일시적인 서버 오류')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('복구된 태스크')).toBeInTheDocument()
    expect(getTasks).toHaveBeenCalledTimes(2)
  })

  it('데이터가 없으면 빈 상태 안내를 보여준다', async () => {
    renderBoard(makeClient({ getTasks: vi.fn().mockResolvedValue([]) }))
    expect(await screen.findByText('태스크가 없습니다.')).toBeInTheDocument()
  })

  it('StrictMode 이중 마운트에도 초기 로드는 한 번만 요청한다', async () => {
    const getTasks = vi.fn().mockResolvedValue([])
    const store = createTaskStore(makeClient({ getTasks }), seqIdGen())
    render(
      <StrictMode>
        <StoreProvider value={store}>
          <Board />
        </StoreProvider>
      </StrictMode>,
    )
    await screen.findByText('태스크가 없습니다.')
    expect(getTasks).toHaveBeenCalledTimes(1)
  })
})
