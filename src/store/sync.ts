import type { Task } from '../types'

export type SyncMessage = { type: 'upsert'; task: Task } | { type: 'remove'; id: string }

export interface TabSync {
  publishUpsert: (task: Task) => void
  publishRemove: (id: string) => void
  dispose: () => void
}

const noopSync: TabSync = {
  publishUpsert: () => {},
  publishRemove: () => {},
  dispose: () => {},
}

export function createTabSync(
  channelName: string | undefined,
  handlers: {
    onUpsert: (task: Task) => void
    onRemove: (id: string) => void
  },
): TabSync {
  if (!channelName || typeof BroadcastChannel === 'undefined') return noopSync
  const channel = new BroadcastChannel(channelName)
  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const message = event.data
    if (message.type === 'upsert') handlers.onUpsert(message.task)
    else if (message.type === 'remove') handlers.onRemove(message.id)
  }
  return {
    publishUpsert: (task) => channel.postMessage({ type: 'upsert', task } satisfies SyncMessage),
    publishRemove: (id) => channel.postMessage({ type: 'remove', id } satisfies SyncMessage),
    dispose: () => channel.close(),
  }
}
