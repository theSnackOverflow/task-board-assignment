import type { Task, Status } from '../types'
import { Card } from './Card'

interface Props {
  title: string
  status: Status
  tasks: Task[]
  pendingIds: Set<string>
  onMove: (id: string, status: Status) => void
}

export function Column({ title, status, tasks, pendingIds, onMove }: Props) {
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
      </h2>
      <div className="column-body">
        {tasks.map((t) => (
          <Card key={t.id} task={t} pending={pendingIds.has(t.id)} />
        ))}
      </div>
    </section>
  )
}
