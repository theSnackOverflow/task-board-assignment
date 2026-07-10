import type { Task, Status } from '../types'
import { Card } from './Card'

interface Props {
  title: string
  status: Status
  tasks: Task[]
  pendingIds: Set<string>
  emptyLabel?: string
  onMove: (id: string, status: Status) => void
  onAdd: () => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
}

export function Column({
  title,
  status,
  tasks,
  pendingIds,
  emptyLabel,
  onMove,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  return (
    <section
      className="column"
      aria-label={title}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/plain')
        if (id) onMove(id, status)
      }}
    >
      <h2 className="column-title">
        {title} <span className="count">{tasks.length}</span>
        <button
          type="button"
          className="column-add"
          aria-label={`${title}에 태스크 추가`}
          onClick={onAdd}
        >
          +
        </button>
      </h2>
      <div className="column-body">
        {tasks.length === 0 && emptyLabel ? (
          <p className="column-empty">{emptyLabel}</p>
        ) : (
          tasks.map((t) => (
            <Card
              key={t.id}
              task={t}
              pending={pendingIds.has(t.id)}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  )
}
