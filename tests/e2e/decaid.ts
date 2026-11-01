// Direct access to the simulated Decaid, for arranging state and checking what Mono did.
export const DECAID = process.env.DECAID_URL ?? 'http://localhost:8080'

export async function decaid<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(DECAID + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`)
  return (text ? JSON.parse(text) : undefined) as T
}

export async function machineState(): Promise<string> {
  const snapshot = await decaid<{ state: { state: string } }>('GET', '/api/v1/machine/state')
  return snapshot.state.state
}

export async function waitForMachineState(expected: string, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < until) {
    last = await machineState()
    if (last === expected) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`machine stayed "${last}", expected "${expected}"`)
}

// Everything Mono could conceivably configure. Used to prove Mono changes nothing on its own.
export async function configurationSnapshot() {
  const paths = [
    '/api/v1/workflow',
    '/api/v1/machine/shotSettings',
    '/api/v1/machine/settings',
    '/api/v1/machine/settings/advanced',
    '/api/v1/settings',
    '/api/v1/presence/settings',
    '/api/v1/presence/schedules',
    '/api/v1/store/mono',
    '/api/v1/store/streamline-app',
  ]
  const entries = await Promise.all(paths.map(async (path) => {
    try {
      return [path, await decaid('GET', path)] as const
    } catch (error) {
      return [path, `unavailable: ${(error as Error).message.split('→')[1]?.trim().slice(0, 3)}`] as const
    }
  }))
  return Object.fromEntries(entries)
}
