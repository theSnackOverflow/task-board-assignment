import '@testing-library/jest-dom'

type BroadcastListener = (event: { data: unknown }) => void

class TestBroadcastChannel {
  private static registry = new Map<string, Set<TestBroadcastChannel>>()
  onmessage: BroadcastListener | null = null
  private closed = false

  constructor(readonly name: string) {
    const peers = TestBroadcastChannel.registry.get(name) ?? new Set()
    peers.add(this)
    TestBroadcastChannel.registry.set(name, peers)
  }

  postMessage(data: unknown) {
    if (this.closed) return
    const peers = TestBroadcastChannel.registry.get(this.name)
    if (!peers) return
    for (const peer of peers) {
      if (peer === this || peer.closed) continue
      queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }))
    }
  }

  close() {
    this.closed = true
    TestBroadcastChannel.registry.get(this.name)?.delete(this)
  }
}

globalThis.BroadcastChannel = TestBroadcastChannel as unknown as typeof BroadcastChannel

if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver
}

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
