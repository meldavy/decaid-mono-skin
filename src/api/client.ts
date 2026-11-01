import { currentGateway } from './gateway'

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) {
    super(message)
  }
}

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE'

export async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(currentGateway().http + path, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    // Some endpoints answer with plain text; keep it as-is.
  }
  if (!response.ok) {
    const message = (parsed as { message?: string; error?: string } | undefined)?.message
      ?? (parsed as { error?: string } | undefined)?.error
      ?? `${method} ${path} failed (${response.status})`
    throw new ApiError(response.status, parsed, message)
  }
  return parsed as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}
