import { MONO, readKey, writeKey } from '../api/store'
import { createResource } from './resource'

// Mono's own preferences. Defaults live here and are never written; only changed keys are stored.

export const ACCENTS = {
  crema: '#C98B2B',
  rust: '#B4532A',
  slate: '#4C6E91',
  teal: '#3D7F7A',
} as const

export const THEMES = ['light', 'dark', 'auto'] as const // auto follows the tablet's own dark setting

export interface Prefs {
  theme: (typeof THEMES)[number]
  accent: keyof typeof ACCENTS
  units: 'c' | 'f'
  clock: '24' | '12'
  language: string
  completionSound: boolean
  sleepBrightness: number // backlight % on the sleep screen (Streamline's screen saver dims to 10)
  screenOffAfter: number // seconds on the sleep screen before going dark; 0 = never
  wakeProfile: string // profile id loaded when the machine wakes; '' = leave it
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  accent: 'crema',
  units: 'c',
  clock: '24',
  language: 'en',
  completionSound: false,
  sleepBrightness: 10,
  screenOffAfter: 60,
  wakeProfile: '',
}

export const DEFAULT_TARGET_TIME = 25

export function withDefaults(stored: Partial<Prefs> | null): Prefs {
  const merged = { ...DEFAULT_PREFS }
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      if (key in stored && typeof stored[key] === typeof DEFAULT_PREFS[key]) (merged as Record<string, unknown>)[key] = stored[key]
    }
  }
  if (!(merged.accent in ACCENTS)) merged.accent = DEFAULT_PREFS.accent
  if (!THEMES.includes(merged.theme)) merged.theme = DEFAULT_PREFS.theme
  return merged
}

const storedPrefs = createResource(() => readKey<Partial<Prefs>>(MONO, 'prefs'), 30_000)
export const prefsResource = storedPrefs

export async function savePref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  const current = (await readKey<Partial<Prefs>>(MONO, 'prefs')) ?? {}
  const next = { ...current, [key]: value }
  await writeKey(MONO, 'prefs', next)
  storedPrefs.set(next)
}

// Shot target time per profile id. Missing → DEFAULT_TARGET_TIME, not stored.
export const targetTimes = createResource(async () => (await readKey<Record<string, number>>(MONO, 'target-times')) ?? {}, 30_000)

export async function saveTargetTime(profileId: string, seconds: number) {
  const current = (await readKey<Record<string, number>>(MONO, 'target-times')) ?? {}
  const next = { ...current, [profileId]: seconds }
  await writeKey(MONO, 'target-times', next)
  targetTimes.set(next)
}
