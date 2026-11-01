import { api } from '../api/client'
import { MONO, readKey, writeKey } from '../api/store'
import type { Profile, ProfileRecord } from '../domain/profile'
import { favourites, saveFavourites } from './favourites'
import { keyboardResource } from './keyboard'
import { createResource } from './resource'
import { saveWorkflow, type Workflow } from './workflow'

// Visible and hidden profiles (deleted ones are left out).
export const profiles = createResource(async () => (await api.get<ProfileRecord[]>('/api/v1/profiles?includeHidden=true')).filter((p) => p.visibility !== 'deleted'), 30_000)

// Decaid's workflow holds a copy of the profile without its id; match it back by title,
// preferring favourites, then visible profiles.
export function activeProfileId(current: Profile | undefined, records: ProfileRecord[], favouriteIds: (string | null)[]): string | null {
  if (!current?.title) return null
  const title = current.title.trim().toLowerCase()
  const matches = records.filter((r) => r.visibility !== 'deleted' && r.profile.title?.trim().toLowerCase() === title)
  if (!matches.length) return null
  return (matches.find((r) => favouriteIds.includes(r.id)) ?? matches.find((r) => r.visibility === 'visible') ?? matches[0]).id
}

// Makes a profile the machine's profile. Yield follows the profile when it defines a target weight.
export function loadProfile(record: ProfileRecord, current: Workflow | null) {
  const targetYield = record.profile.target_weight || current?.context?.targetYield
  return saveWorkflow({ profile: record.profile, context: targetYield ? { targetYield } : undefined })
}

export interface ProfileRecordFull extends ProfileRecord { createdAt?: string; updatedAt?: string }

export async function setVisibility(id: string, visibility: 'visible' | 'hidden') {
  await api.put(`/api/v1/profiles/${encodeURIComponent(id)}/visibility`, { visibility })
  await profiles.refresh()
}

// Deletes your own profile (Decaid hides a built-in instead). Its favourite slot, if any, is emptied.
export async function deleteProfile(id: string) {
  await api.del(`/api/v1/profiles/${encodeURIComponent(id)}`)
  const slots = favourites.get().value
  if (slots?.includes(id)) await saveFavourites(slots.map((s) => (s === id ? null : s)))
  // A profile key for a deleted profile goes too.
  const keys = await readKey<{ profiles?: Record<string, string> }>(MONO, 'keyboard')
  if (keys?.profiles && Object.values(keys.profiles).includes(id)) {
    await writeKey(MONO, 'keyboard', { ...keys, profiles: Object.fromEntries(Object.entries(keys.profiles).filter(([, v]) => v !== id)) })
    await keyboardResource.refresh()
  }
  await profiles.refresh()
}

export async function createProfile(profile: Profile, parentId?: string) {
  const record = await api.post<ProfileRecord>('/api/v1/profiles', { profile, parentId: parentId ?? null })
  await profiles.refresh()
  return record
}

// A Decent v2 profile JSON file. Throws with a plain message when the file isn't one.
export function parseProfileFile(text: string): Profile {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error("That file isn't a profile Mono can read.") }
  const p = (data && typeof data === 'object' && 'profile' in (data as object) ? (data as { profile: unknown }).profile : data) as Partial<Profile>
  if (!p || typeof p !== 'object' || typeof p.title !== 'string' || !Array.isArray(p.steps) || !p.steps.length) {
    throw new Error("That file isn't a profile Mono can read.")
  }
  return p as Profile
}
