// Decaid's REST and WebSocket API always listens on port 8080 of the host serving the skin.
// Overrides exist for development: ?gateway=host[:port], then localStorage.monoGateway,
// then Streamline's localStorage.reaHostname so a tablet already pointed elsewhere keeps working.

export const DEFAULT_PORT = 8080

export interface Gateway {
  http: string
  ws: string
}

interface Sources {
  search: string
  hostname: string
  storage: Pick<Storage, 'getItem'> | null
}

function readStorage(storage: Sources['storage'], key: string): string | null {
  try {
    return storage?.getItem(key) || null
  } catch {
    return null
  }
}

export function resolveGateway({ search, hostname, storage }: Sources): Gateway {
  const fromQuery = new URLSearchParams(search).get('gateway')
  const raw = (fromQuery || readStorage(storage, 'monoGateway') || readStorage(storage, 'reaHostname') || hostname || 'localhost').trim()
  const host = raw.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
  const withPort = /:\d+$/.test(host) || host.startsWith('[') && host.endsWith(']:') ? host : `${host}:${DEFAULT_PORT}`
  return { http: `http://${withPort}`, ws: `ws://${withPort}` }
}

export function currentGateway(): Gateway {
  let storage: Storage | null = null
  try {
    storage = window.localStorage
  } catch {
    storage = null
  }
  return resolveGateway({ search: window.location.search, hostname: window.location.hostname, storage })
}
