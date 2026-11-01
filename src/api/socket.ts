import { currentGateway } from './gateway'

export type SocketStatus = 'connecting' | 'open' | 'closed'

export interface SocketHandle {
  close(): void
}

// Opens a Decaid WebSocket and keeps it open: reconnects with backoff (0.5 s doubling to 10 s)
// and resets the backoff once a message arrives.
export function openSocket<T>(
  path: string,
  onMessage: (message: T) => void,
  onStatus?: (status: SocketStatus) => void,
): SocketHandle {
  let socket: WebSocket | null = null
  let delay = 500
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const connect = () => {
    if (stopped) return
    onStatus?.('connecting')
    socket = new WebSocket(currentGateway().ws + path)
    socket.onopen = () => onStatus?.('open')
    socket.onmessage = (event) => {
      delay = 500
      try {
        onMessage(JSON.parse(String(event.data)) as T)
      } catch {
        // Ignore frames that are not JSON.
      }
    }
    socket.onclose = () => {
      onStatus?.('closed')
      if (stopped) return
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 10_000)
    }
    socket.onerror = () => socket?.close()
  }

  connect()
  return {
    close() {
      stopped = true
      clearTimeout(timer)
      socket?.close()
    },
  }
}
