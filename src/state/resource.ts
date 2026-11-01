import { useCallback, useRef, useSyncExternalStore } from 'react'

// A value read from Decaid with GET only: loaded on first use, re-read on an interval and when the page
// becomes visible again, so changes made elsewhere show up. Writers call `set` after Decaid confirms.

export interface Resource<T> {
  get(): ResourceState<T>
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  set(value: T): void
}

export interface ResourceState<T> {
  value: T | null
  error: Error | null
  loaded: boolean
}

export function createResource<T>(load: () => Promise<T>, intervalMs = 5_000): Resource<T> {
  let state: ResourceState<T> = { value: null, error: null, loaded: false }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let inflight: Promise<void> | null = null

  const emit = (next: ResourceState<T>) => {
    state = next
    listeners.forEach((l) => l())
  }
  const refresh = () => {
    inflight ??= load()
      .then((value) => emit({ value, error: null, loaded: true }))
      .catch((error: Error) => emit({ ...state, error, loaded: true }))
      .finally(() => { inflight = null })
    return inflight
  }
  const onVisible = () => document.visibilityState === 'visible' && refresh()

  return {
    get: () => state,
    refresh,
    set: (value) => emit({ value, error: null, loaded: true }),
    subscribe(listener) {
      if (listeners.size === 0) {
        void refresh()
        if (intervalMs > 0) timer = setInterval(refresh, intervalMs)
        document.addEventListener('visibilitychange', onVisible)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }
    },
  }
}

export function useResource<T>(resource: Resource<T>): ResourceState<T> {
  return useSyncExternalStore(resource.subscribe, resource.get)
}

// Runs `fn` at most once at a time; repeat calls while it runs get the same promise (no double sends).
export function useSingleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const running = useRef<Promise<R> | null>(null)
  return useCallback((...args: A) => {
    running.current ??= fn(...args).finally(() => { running.current = null })
    return running.current
  }, [fn])
}

export function useNow(intervalMs: number) {
  const ref = useRef(Date.now())
  // Stable subscribe: a new function each render would restart the timer on every live update.
  const subscribe = useCallback((cb: () => void) => {
    const t = setInterval(() => { ref.current = Date.now(); cb() }, intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return useSyncExternalStore(subscribe, () => ref.current)
}
