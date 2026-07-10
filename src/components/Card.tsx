import { memo } from 'react'
import type { Task } from '../types'

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

interface Props {
  task: Task
  pending?: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onDragChange: (id: string | null) => void
}

export const Card = memo(function Card({ task, pending, onEdit, onDelete, onDragChange }: Props) {
  return (
    <article
      className={`card priority-${task.priority}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id)
        onDragChange(task.id)
      }}
      onDragEnd={() => onDragChange(null)}
    >
      {pending && <span className="pending-dot" aria-label="저장 중" />}
      <div className="card-actions">
        <button type="button" aria-label={`${task.title} 수정`} onClick={() => onEdit(task)}>
          수정
        </button>
        <button type="button" aria-label={`${task.title} 삭제`} onClick={() => onDelete(task)}>
          삭제
        </button>
      </div>
      <div className="card-title" title={task.title}>
        {task.title}
      </div>
      <div className="card-meta">
        <span className={`badge badge-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        <span className="date">{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    </article>
  )
})
