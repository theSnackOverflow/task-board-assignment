import { useEffect } from 'react'
import { useTaskStore } from './useTasks'

export function useOnline() {
  const store = useTaskStore()

  useEffect(() => {
    if (!navigator.onLine) store.actions.goOffline()
    const handleOffline = () => store.actions.goOffline()
    const handleOnline = () => store.actions.goOnline()
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [store])
}
