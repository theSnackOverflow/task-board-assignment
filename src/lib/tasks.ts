import type { Task, Status, Priority } from '../types'

export function moveTask(tasks: Task[], id: string, status: Status): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, status } : t))
}

export function filterByTitle(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return tasks
  return tasks.filter((t) => t.title.toLowerCase().includes(q))
}

export function filterByPriority(tasks: Task[], selected: Priority[]): Task[] {
  if (selected.length === 0) return tasks
  return tasks.filter((t) => selected.includes(t.priority))
}
