import type { ToastItem } from '../types'

const MAX_VISIBLE = 3

export function appendToast(
  toasts: ToastItem[],
  input: Omit<ToastItem, 'id'>,
  id: string,
): ToastItem[] {
  const next = [...toasts, { ...input, id }]
  if (next.length <= MAX_VISIBLE) return next
  const dropIndex = next.findIndex((t) => !t.sticky)
  next.splice(dropIndex === -1 ? 0 : dropIndex, 1)
  return next
}
