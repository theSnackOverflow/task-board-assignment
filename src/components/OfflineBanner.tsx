import { useStoreState } from '../hooks/useTasks'

export function OfflineBanner() {
  const { paused } = useStoreState()
  if (!paused) return null
  return (
    <div className="offline-banner" role="status">
      오프라인 상태입니다. 연결되면 자동으로 다시 시도합니다.
    </div>
  )
}
