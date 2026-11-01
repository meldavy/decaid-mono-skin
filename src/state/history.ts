import { api } from '../api/client'
import { createResource } from './resource'
import type { StoredShot } from '../domain/history'

// History reads Decaid's shots a page at a time: the list first (small), then the full records of
// that page (with measurements) for the charts and numbers.
export const PAGE = 20

export interface ShotPage { items: StoredShot[]; total: number }

export function fetchPage(offset: number, search: string, signal?: AbortSignal) {
  const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (search.trim()) q.set('search', search.trim())
  return api.get<ShotPage>(`/api/v1/shots?${q}`, signal)
}

export function fetchFull(ids: string[], signal?: AbortSignal) {
  if (!ids.length) return Promise.resolve([] as StoredShot[])
  return api.get<StoredShot[]>(`/api/v1/shots?ids=${ids.map(encodeURIComponent).join(',')}`, signal)
}

export const VISUALIZER = 'visualizer.reaplugin'

export function uploadToVisualizer(shotId: string) {
  return api.post<{ visualizer_id?: string }>(`/api/v1/plugins/${VISUALIZER}/upload`, { shotId })
}

// The newest shot of each profile among the last 100, for Home's cards. Titles are how shots name their profile.
export const lastShots = createResource(async () => {
  const { items, total } = await api.get<ShotPage>('/api/v1/shots?limit=100')
  const byTitle = new Map<string, StoredShot>()
  for (const s of items) { const t = s.workflow?.profile?.title; if (t && !byTitle.has(t)) byTitle.set(t, s) }
  return { byTitle, all: items.length >= total }
}, 60_000)
