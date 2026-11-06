import { api } from '../api/client'
import { MONO, readKey, writeKey } from '../api/store'
import type { ProfileRecord } from '../domain/profile'
import { favourites, SLOT_COUNT, saveFavourites, type Slots } from './favourites'
import { createProfile, profiles } from './profiles'
import { DYE2, recipeProfile, type Recipe } from './recipes'
import { createResource } from './resource'

// The five favourite slots are shared with Streamline and hold profile ids. A slot can also hold a recipe: Mono
// notes which recipe here, and the shared slot holds the recipe's profile, so Streamline still shows something
// sensible there. A note only counts while the shared slot still holds that profile (Streamline may have changed it).

export interface RecipeSlot { recipeId: string; profileId: string }
export type RecipeSlots = Record<string, RecipeSlot>

export type Entry = { kind: 'profile'; id: string } | { kind: 'recipe'; id: string }

export const recipeSlots = createResource(async () => (await readKey<RecipeSlots>(MONO, 'recipe-slots')) ?? {}, 10_000)

// What each slot holds, recipes first where their note still matches.
export function slotEntries(slots: Slots, notes: RecipeSlots | null, recipeIds: Set<string>): (Entry | null)[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const note = notes?.[i]
    if (note && slots[i] === note.profileId && recipeIds.has(note.recipeId)) return { kind: 'recipe', id: note.recipeId }
    return slots[i] ? { kind: 'profile', id: slots[i]! } : null
  })
}

// The library record for a recipe's profile: one with the same title, else the profile is added to the library.
async function profileIdFor(recipe: Recipe, records: ProfileRecord[]) {
  const p = recipeProfile(recipe)
  if (!p) throw new Error('That recipe has no profile, so it can’t be a favourite.')
  const title = p.title.trim().toLowerCase()
  const same = records.find((r) => r.visibility !== 'deleted' && r.profile.title.trim().toLowerCase() === title)
  return same ? same.id : (await createProfile(p)).id
}

export async function saveSlotEntries(entries: (Entry | null)[], recipesById: Map<string, Recipe>) {
  const records = profiles.get().value ?? []
  const slots: Slots = []
  const notes: RecipeSlots = {}
  for (const [i, e] of entries.entries()) {
    if (!e) { slots.push(null); continue }
    if (e.kind === 'profile') { slots.push(e.id); continue }
    const recipe = recipesById.get(e.id)
    if (!recipe) { slots.push(null); continue }
    const profileId = await profileIdFor(recipe, records)
    slots.push(profileId)
    notes[i] = { recipeId: e.id, profileId }
  }
  await writeKey(MONO, 'recipe-slots', notes)
  recipeSlots.set(notes)
  await saveFavourites(slots)
}

export const sameEntry = (a: Entry | null, b: Entry | null) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.id ?? null) === (b?.id ?? null)

// DYE2's answer to "which recipe is on the machine": the one applied last, while its profile is still loaded.
export interface Dye2Selection { kind?: 'recipe' | 'favourite'; id?: string; modified?: boolean }
export const dye2Selection = createResource(async () => {
  try { return (await api.get<Dye2Selection | null>(`/api/v1/plugins/${DYE2}/selection`)) ?? null } catch { return null }
}, 10_000)

export { favourites }
