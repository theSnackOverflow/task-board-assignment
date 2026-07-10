import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Priority, Status } from '../types'

export interface TaskFormValue {
  title: string
  priority: Priority
  description?: string
  status: Status
}

interface Props {
  open: boolean
  initialStatus: Status
  onSubmit: (value: TaskFormValue) => void
  onClose: () => void
}

export function TaskModal({ open, initialStatus, onSubmit, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    if (!open) setError(null)
  }, [open])

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    if (!title) {
      setError('제목을 입력해 주세요.')
      return
    }
    const description = String(data.get('description') ?? '').trim()
    onSubmit({
      title,
      priority: data.get('priority') as Priority,
      description: description || undefined,
      status: initialStatus,
    })
    setError(null)
    form.reset()
    onClose()
  }

  return (
    <dialog ref={dialogRef} className="task-modal" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2>태스크 추가</h2>
        <label>
          제목
          <input name="title" autoComplete="off" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label>
          우선순위
          <select name="priority" defaultValue="medium">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          설명 (선택)
          <textarea name="description" rows={3} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            추가
          </button>
        </div>
      </form>
    </dialog>
  )
}
