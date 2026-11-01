import { readKey, STREAMLINE, writeKey } from '../api/store'
import { createResource } from './resource'

// Streamline's five shared favourite slots: {"0": profileId | null, …, "4": …}.
export const SLOT_COUNT = 5
export type Slots = (string | null)[]

export function parseSlots(raw: unknown): Slots {
  const slots: Slots = new Array(SLOT_COUNT).fill(null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return slots
  for (let i = 0; i < SLOT_COUNT; i++) {
    const v = (raw as Record<string, unknown>)[i]
    slots[i] = typeof v === 'string' && v ? v : null
  }
  return slots
}

export function serializeSlots(slots: Slots): Record<string, string | null> {
  return Object.fromEntries(slots.slice(0, SLOT_COUNT).map((id, i) => [String(i), id ?? null]))
}

export const favourites = createResource(async () => parseSlots(await readKey(STREAMLINE, 'favorite-profiles')), 10_000)

// Only ever called from an explicit save. Also marks the slots as set by a person, which tells
// Streamline not to auto-fill them.
export async function saveFavourites(slots: Slots) {
  await writeKey(STREAMLINE, 'favorite-profiles', serializeSlots(slots))
  await writeKey(STREAMLINE, 'favorite-profiles-initialized', true)
  favourites.set(parseSlots(serializeSlots(slots)))
}
