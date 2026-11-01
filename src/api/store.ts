import { api } from './client'

// Decaid's key-value store. A missing key reads as null.
export const MONO = 'mono'
export const STREAMLINE = 'streamline-app'

export function readKey<T>(namespace: string, key: string): Promise<T | null> {
  return api.get<T | null>(`/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`)
}

export function writeKey<T>(namespace: string, key: string, value: T): Promise<void> {
  return api.post<void>(`/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, value)
}
