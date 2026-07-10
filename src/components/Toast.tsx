import { useEffect } from 'react'
import { useStoreState, useTaskStore } from '../hooks/useTasks'
import type { ToastItem } from '../types'

export function ToastStack() {
  const store = useTaskStore()
  const { toasts } = useStoreState()
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={store.actions.dismissToast} />
      ))}
    </div>
  )
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (toast.sticky) return
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.sticky, onDismiss])

  return (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.run()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="알림 닫기"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  )
}
