export interface WindowRange {
  start: number
  end: number
  totalHeight: number
}

export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan: number,
  forcedIndex?: number,
): WindowRange {
  if (count === 0) return { start: 0, end: 0, totalHeight: 0 }
  const firstVisible = Math.floor(scrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  let start = Math.max(0, firstVisible - overscan)
  let end = Math.min(count, firstVisible + visibleCount + overscan)
  if (forcedIndex !== undefined && forcedIndex >= 0 && forcedIndex < count) {
    start = Math.min(start, forcedIndex)
    end = Math.max(end, forcedIndex + 1)
  }
  return { start, end, totalHeight: count * rowHeight }
}
