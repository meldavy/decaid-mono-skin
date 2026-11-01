import { api } from '../api/client'
import { MONO, readKey, writeKey } from '../api/store'
import type { Profile, ProfileRecord } from '../domain/profile'
import { favourites, saveFavourites } from './favourites'
import { keyboardResource } from './keyboard'
import { targetTimes } from './prefs'
import { profiles } from './profiles'
import { saveWorkflow, workflow } from './workflow'

// Saving from the editor. Decaid identifies a profile by its recipe, so:
//  - renaming your own profile keeps its id;
//  - changing its recipe gives it a new id — Mono carries everything that pointed at the old id over;
//  - a draft whose recipe matches an existing profile isn't a new profile at all.

export type SaveOutcome =
  | { kind: 'saved'; record: ProfileRecord } // updated or created
  | { kind: 'same'; record: ProfileRecord } // the recipe already exists under this record

export async function saveOwn(id: string, profile: Profile, onMachine: boolean): Promise<SaveOutcome> {
  const record = await api.put<ProfileRecord>(`/api/v1/profiles/${encodeURIComponent(id)}`, { profile })
  if (record.id !== id) await carryOver(id, record.id, false)
  if (onMachine) await saveWorkflow({ profile: record.profile })
  await profiles.refresh()
  return { kind: 'saved', record }
}

export async function saveDraft(profile: Profile, source: ProfileRecord | null, onMachine: boolean): Promise<SaveOutcome> {
  const known = new Set((profiles.get().value ?? []).map((r) => r.id))
  const record = await api.post<ProfileRecord>('/api/v1/profiles', { profile, parentId: source?.id ?? null })
  if (known.has(record.id)) return { kind: 'same', record }
  // Editing a built-in forks it: its favourite slot follows the new profile.
  if (source?.isDefault) await carryOver(source.id, record.id, true)
  if (onMachine) await saveWorkflow({ profile: record.profile })
  await profiles.refresh()
  return { kind: 'saved', record }
}

// Points Mono's references at the new id: favourite slot, keyboard profile key, shot-target time.
async function carryOver(from: string, to: string, slotsOnly: boolean) {
  const slots = favourites.get().value
  if (slots?.includes(from)) await saveFavourites(slots.map((s) => (s === from ? to : s)))
  if (slotsOnly) return
  const keys = await readKey<{ profiles?: Record<string, string> }>(MONO, 'keyboard')
  if (keys?.profiles && Object.values(keys.profiles).includes(from)) {
    await writeKey(MONO, 'keyboard', { ...keys, profiles: Object.fromEntries(Object.entries(keys.profiles).map(([k, v]) => [k, v === from ? to : v])) })
    await keyboardResource.refresh()
  }
  const times = await readKey<Record<string, number>>(MONO, 'target-times')
  if (times && from in times) {
    const { [from]: t, ...rest } = times
    await writeKey(MONO, 'target-times', { ...rest, [to]: t })
    await targetTimes.refresh()
  }
  void workflow.refresh()
}
