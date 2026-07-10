import { useEffect, useMemo, useState } from 'react'
import type { Task, Status } from './types'
import { Column } from './components/Column'
import { DeleteDialog } from './components/DeleteDialog'
import { TaskModal } from './components/TaskModal'
import { useBoardTasks, useStoreState, useTaskStore } from './hooks/useTasks'
import { pendingTaskIds } from './lib/mutations'

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

type ModalState = { mode: 'create'; status: Status } | { mode: 'edit'; task: Task } | null

export default function Board() {
  const store = useTaskStore()
  const state = useStoreState()
  const tasks = useBoardTasks()
  const [modal, setModal] = useState<ModalState>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)

  useEffect(() => {
    void store.actions.loadTasks()
  }, [store])

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks) map[t.status].push(t)
    return map
  }, [tasks])

  const pendingIds = useMemo(() => pendingTaskIds(state.queue), [state.queue])

  const dialogs = (
    <>
      <TaskModal
        key={modal?.mode === 'edit' ? modal.task.id : 'create'}
        open={modal !== null}
        mode={modal?.mode ?? 'create'}
        initialStatus={modal?.mode === 'create' ? modal.status : 'todo'}
        initialValue={modal?.mode === 'edit' ? modal.task : undefined}
        onSubmit={(value) => {
          if (modal?.mode === 'edit') {
            store.actions.edit(modal.task.id, {
              title: value.title,
              priority: value.priority,
              description: value.description,
            })
          } else {
            store.actions.create(value)
          }
        }}
        onClose={() => setModal(null)}
      />
      <DeleteDialog
        task={deleting}
        onConfirm={store.actions.remove}
        onClose={() => setDeleting(null)}
      />
    </>
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
        <button type="button" onClick={() => setModal({ mode: 'create', status: 'todo' })}>
          첫 태스크 추가
        </button>
        {dialogs}
      </div>
    )
  }

  return (
    <>
      <div className="board-toolbar">
        <button
          type="button"
          className="add-task"
          onClick={() => setModal({ mode: 'create', status: 'todo' })}
        >
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
            onAdd={() => setModal({ mode: 'create', status: col.status })}
            onEdit={(task) => setModal({ mode: 'edit', task })}
            onDelete={setDeleting}
          />
        ))}
      </div>
      {dialogs}
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
