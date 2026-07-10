import { useEffect, useMemo, useState } from 'react'
import type { Task, Status } from './types'
import { Column } from './components/Column'
import { TaskModal } from './components/TaskModal'
import { useBoardTasks, useStoreState, useTaskStore } from './hooks/useTasks'
import { pendingTaskIds } from './lib/mutations'

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

export default function Board() {
  const store = useTaskStore()
  const state = useStoreState()
  const tasks = useBoardTasks()
  const [createFor, setCreateFor] = useState<Status | null>(null)

  useEffect(() => {
    void store.actions.loadTasks()
  }, [store])

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks) map[t.status].push(t)
    return map
  }, [tasks])

  const pendingIds = useMemo(() => pendingTaskIds(state.queue), [state.queue])

  const createModal = (
    <TaskModal
      open={createFor !== null}
      initialStatus={createFor ?? 'todo'}
      onSubmit={store.actions.create}
      onClose={() => setCreateFor(null)}
    />
  )

  if (state.load.status === 'idle' || state.load.status === 'loading') {
    return <BoardSkeleton />
  }

  if (state.load.status === 'error') {
    return (
      <div className="board-status" role="alert">
        <p>{state.load.error ?? '데이터를 불러오지 못했습니다.'}</p>
        <button type="button" onClick={() => store.actions.retryLoad()}>
          다시 시도
        </button>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="board-status">
        <p>태스크가 없습니다.</p>
        <button type="button" onClick={() => setCreateFor('todo')}>
          첫 태스크 추가
        </button>
        {createModal}
      </div>
    )
  }

  return (
    <>
      <div className="board-toolbar">
        <button type="button" className="add-task" onClick={() => setCreateFor('todo')}>
          + 태스크 추가
        </button>
      </div>
      <div className="board">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            title={col.title}
            status={col.status}
            tasks={byStatus[col.status]}
            pendingIds={pendingIds}
            onMove={store.actions.move}
            onAdd={() => setCreateFor(col.status)}
          />
        ))}
      </div>
      {createModal}
    </>
  )
}

function BoardSkeleton() {
  return (
    <div className="board" aria-busy="true" aria-label="불러오는 중">
      {COLUMNS.map((col) => (
        <section key={col.status} className="column">
          <h2 className="column-title">{col.title}</h2>
          <div className="column-body">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card card-skeleton" />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
