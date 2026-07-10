import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Task, Status, Priority } from './types'
import { Column } from './components/Column'
import { DeleteDialog } from './components/DeleteDialog'
import { TaskModal } from './components/TaskModal'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { useBoardTasks, useStoreState, useTaskStore } from './hooks/useTasks'
import { pendingTaskIds } from './lib/mutations'
import { filterByPriority, filterByTitle } from './lib/tasks'

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

type ModalState = { mode: 'create'; status: Status } | { mode: 'edit'; task: Task } | null

export default function Board() {
  const store = useTaskStore()
  const state = useStoreState()
  const tasks = useBoardTasks()
  const [modal, setModal] = useState<ModalState>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [query, setQuery] = useState('')
  const [priorities, setPriorities] = useState<Priority[]>([])

  useEffect(() => {
    void store.actions.loadTasks()
  }, [store])

  const debouncedQuery = useDebouncedValue(query, 180)
  const deferredQuery = useDeferredValue(debouncedQuery)

  const filtered = useMemo(
    () => filterByPriority(filterByTitle(tasks, deferredQuery), priorities),
    [tasks, deferredQuery, priorities],
  )

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of filtered) map[t.status].push(t)
    return map
  }, [filtered])

  const pendingIds = useMemo(() => pendingTaskIds(state.queue), [state.queue])

  const filterActive = deferredQuery.trim() !== '' || priorities.length > 0

  function togglePriority(value: Priority) {
    setPriorities((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    )
  }

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
        <div className="filter-group">
          <input
            type="search"
            className="search-input"
            placeholder="제목 검색"
            aria-label="제목 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`filter-chip${priorities.includes(p.value) ? ' active' : ''}`}
              aria-pressed={priorities.includes(p.value)}
              onClick={() => togglePriority(p.value)}
            >
              {p.label}
            </button>
          ))}
          {filterActive && <span className="search-count">{filtered.length}건</span>}
        </div>
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
            emptyLabel={filterActive ? '검색 결과 없음' : undefined}
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
