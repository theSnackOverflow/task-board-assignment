import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { applyPending } from '../lib/mutations'
import { taskStore, type TaskStore } from '../store/taskStore'
import type { StoreState, Task } from '../types'

const StoreContext = createContext<TaskStore>(taskStore)

export const StoreProvider = StoreContext.Provider

export function useTaskStore(): TaskStore {
  return useContext(StoreContext)
}

export function useStoreState(): StoreState {
  const store = useTaskStore()
  return useSyncExternalStore(store.subscribe, store.getState)
}

export function useBoardTasks(): Task[] {
  const state = useStoreState()
  return useMemo(() => applyPending(state.server, state.queue), [state.server, state.queue])
}
