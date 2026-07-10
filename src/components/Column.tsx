import { memo, useEffect, useRef, useState } from 'react'
import { computeWindow } from '../lib/windowing'
import type { Task, Status } from '../types'
import { Card } from './Card'

const ROW_HEIGHT = 78
const OVERSCAN = 5

interface Props {
  title: string
  status: Status
  tasks: Task[]
  pendingIds: Set<string>
  draggingId: string | null
  emptyLabel?: string
  onMove: (id: string, status: Status) => void
  onAdd: (status: Status) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onDragChange: (id: string | null) => void
}

export const Column = memo(function Column({
  title,
  status,
  tasks,
  pendingIds,
  draggingId,
  emptyLabel,
  onMove,
  onAdd,
  onEdit,
  onDelete,
  onDragChange,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    setViewportHeight(body.clientHeight)
    const observer = new ResizeObserver(() => {
      setViewportHeight(body.clientHeight)
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  const forcedIndex = draggingId ? tasks.findIndex((t) => t.id === draggingId) : -1
  const { start, end, totalHeight } = computeWindow(
    scrollTop,
    viewportHeight,
    ROW_HEIGHT,
    tasks.length,
    OVERSCAN,
    forcedIndex >= 0 ? forcedIndex : undefined,
  )
  const visible = tasks.slice(start, end)

  return (
    <section
      className="column"
      aria-label={title}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/plain')
        if (id) onMove(id, status)
        onDragChange(null)
      }}
    >
      <h2 className="column-title">
        {title} <span className="count">{tasks.length}</span>
        <button
          type="button"
          className="column-add"
          aria-label={`${title}에 태스크 추가`}
          onClick={() => onAdd(status)}
        >
          +
        </button>
      </h2>
      <div
        ref={bodyRef}
        className="column-body"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {tasks.length === 0 && emptyLabel ? (
          <p className="column-empty">{emptyLabel}</p>
        ) : (
          <div className="column-spacer" style={{ height: totalHeight }}>
            {visible.map((t, i) => (
              <div
                key={t.id}
                className="card-slot"
                style={{ transform: `translateY(${(start + i) * ROW_HEIGHT}px)` }}
              >
                <Card
                  task={t}
                  pending={pendingIds.has(t.id)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onDragChange={onDragChange}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
})
