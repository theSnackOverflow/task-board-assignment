import { useEffect, useRef } from 'react'
import type { Task } from '../types'

interface Props {
  task: Task | null
  onConfirm: (taskId: string) => void
  onClose: () => void
}

export function DeleteDialog({ task, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (task && !dialog.open) dialog.showModal()
    if (!task && dialog.open) dialog.close()
  }, [task])

  return (
    <dialog ref={dialogRef} className="task-modal" onClose={onClose}>
      {task && (
        <div className="delete-dialog">
          <h2>태스크 삭제</h2>
          <p>'{task.title}' 태스크를 삭제할까요?</p>
          <div className="modal-actions">
            <button type="button" autoFocus onClick={onClose}>
              취소
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onConfirm(task.id)
                onClose()
              }}
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
