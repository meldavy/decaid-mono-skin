import { api, ApiError } from '../api/client'
import { MONO, readKey, writeKey } from '../api/store'
import type { StoredShot } from '../domain/history'
import type { Profile, ProfileRecord } from '../domain/profile'
import { createResource } from './resource'
import { saveWorkflow, workflow, type Workflow, type WorkflowPatch } from './workflow'

// Recipes live in DYE2 (docs/KV_CONTRACT.md in decentespresso/dye2), so Streamline and DYE2 see the same ones.
// DYE2 is their only writer: Mono reads its list, creates through its save-recipe route, and edits in DYE2's own
// page. A recipe is applied by putting its stored workflow on the machine, as DYE2 and Streamline do.

export const DYE2 = 'dye2.reaplugin'
const BASE = `/api/v1/plugins/${DYE2}`

export interface Recipe {
  id: string
  name?: string | null
  title?: string | null
  beanName?: string | null
  beanRoaster?: string | null
  profileTitle?: string | null
  capturedAt?: string | null
  dashboardVariables?: { dose?: number | null; drink?: number | null; brewC?: number | null; grind?: number | string | null; grinderModel?: string | null } | null
  workflow?: { context?: Record<string, unknown> | null; profile?: Profile | null; steamSettings?: object; hotWaterData?: object; rinseData?: object } | null
  profileSnapshot?: Profile | null
}

export const recipes = createResource(async () => {
  const rows = await readKey<Recipe[]>(DYE2, 'recipes').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e })
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string') : []
}, 15_000)

// DYE2 present and running. Without it there are no recipes to show or save.
export const dye2Loaded = (list: { id: string; loaded?: boolean }[] | null) => !!list?.some((p) => p.id === DYE2 && p.loaded === true)

export const recipeName = (r: Recipe) => (r.name || r.title || 'Recipe').trim()
export const recipeProfile = (r: Recipe): Profile | null => (r.profileSnapshot?.steps?.length ? r.profileSnapshot : r.workflow?.profile?.steps?.length ? r.workflow.profile : null)
export const recipeGrind = (r: Recipe) => {
  const g = r.dashboardVariables?.grind ?? r.workflow?.context?.grinderSetting
  return g === null || g === undefined || g === '' ? undefined : String(g)
}
export const recipeCoffee = (r: Recipe) => (r.beanName || (r.workflow?.context?.coffeeName as string | undefined) || undefined)
export const recipeGrinder = (r: Recipe) => (r.dashboardVariables?.grinderModel || (r.workflow?.context?.grinderModel as string | undefined) || undefined)

// Profiles and recipes share the carousel. Moving to a recipe first puts the person's own next-shot settings aside
// (once: recipe to recipe keeps the first set); moving back to a profile puts them back. So a recipe never
// overwrites what was set for profiles. Kept in Mono's store, so it survives a reload.
const KEPT = 'profile-settings'
const KEPT_CONTEXT = ['targetDoseWeight', 'targetYield', 'grinderSetting', 'beanBatchId', 'coffeeName', 'coffeeRoaster', 'grinderId', 'grinderModel']
type Kept = Pick<WorkflowPatch, 'context' | 'steamSettings' | 'hotWaterData' | 'rinseData'>

export function keptSettings(w: Workflow): Kept {
  const c = (w.context ?? {}) as Record<string, unknown>
  const context: Record<string, unknown> = {}
  for (const k of KEPT_CONTEXT) context[k] = c[k] ?? null
  if (context.targetYield === null) delete context.targetYield // Decaid refuses a null yield
  return { context: context as Kept['context'], steamSettings: w.steamSettings, hotWaterData: w.hotWaterData, rinseData: w.rinseData }
}

async function keepProfileSettings() {
  if (await readKey<Kept>(MONO, KEPT)) return
  const w = workflow.get().value ?? await api.get<Workflow>('/api/v1/workflow')
  await writeKey(MONO, KEPT, keptSettings(w))
}

// Loads a profile from the carousel or the library. Coming from a recipe, the kept settings come back with it.
// Yield follows the profile when it defines a target weight, as loadProfile does.
export async function loadProfileBack(record: ProfileRecord, current: Workflow | null) {
  const kept = await readKey<Kept>(MONO, KEPT)
  const keptYield = (kept?.context as { targetYield?: number } | undefined)?.targetYield
  const targetYield = record.profile.target_weight || keptYield || current?.context?.targetYield
  await saveWorkflow({ ...(kept ?? {}), profile: record.profile, context: { ...(kept?.context ?? {}), ...(targetYield ? { targetYield } : {}) } })
  if (kept) {
    await api.del(`/api/v1/store/${MONO}/${KEPT}`).catch(() => undefined)
    await api.post(`${BASE}/selection`, {}).catch(() => undefined) // DYE2: no recipe selected any more
  }
}

// What the recipe puts on the machine, then DYE2 is told it's selected (so a dial-in can be saved back to it there).
export async function applyRecipe(r: Recipe) {
  if (!r.workflow) throw new Error('That recipe has nothing to apply. Open it in DYE2 to fix it.')
  await keepProfileSettings()
  const profile = recipeProfile(r)
  await saveWorkflow({ ...(r.workflow as WorkflowPatch), ...(profile ? { profile } : {}) })
  await api.post(`${BASE}/selection`, { kind: 'recipe', id: r.id }).catch(() => undefined) // an older DYE2 has no such route
}

// A shot's settings as the next shot: its profile, dose, yield, coffee, grinder and grind, and its steam, hot water
// and flush. Fields the shot didn't have are cleared (Decaid merges, so leaving them out would keep the current ones).
export function shotWorkflow(shot: StoredShot): WorkflowPatch {
  const w = shot.workflow as (StoredShot['workflow'] & { steamSettings?: object; hotWaterData?: object; rinseData?: object }) | null | undefined
  const c = (w?.context ?? {}) as Record<string, unknown>
  const keep = (k: string) => (c[k] === undefined || c[k] === '' ? null : c[k])
  const context: Record<string, unknown> = {}
  for (const k of ['targetDoseWeight', 'grinderSetting', 'beanBatchId', 'coffeeName', 'coffeeRoaster', 'grinderId', 'grinderModel']) context[k] = keep(k)
  if (typeof c.targetYield === 'number' && c.targetYield > 0) context.targetYield = c.targetYield // never null: Decaid refuses it
  return {
    profile: w?.profile as Profile,
    context: context as WorkflowPatch['context'],
    ...(w?.steamSettings ? { steamSettings: w.steamSettings } : {}),
    ...(w?.hotWaterData ? { hotWaterData: w.hotWaterData } : {}),
    ...(w?.rinseData ? { rinseData: w.rinseData } : {}),
  } as WorkflowPatch
}

// DYE2 saves recipes from the machine's next-shot settings, so the shot is set up first, then saved under the name.
export async function saveShotAsRecipe(shot: StoredShot, name: string) {
  if (!shot.workflow?.profile) throw new Error("That shot has no profile, so it can't be a recipe.")
  await saveWorkflow(shotWorkflow(shot))
  const saved = await api.post<{ id: string; name: string }>(`${BASE}/save-recipe`, { name })
  await Promise.all([recipes.refresh(), workflow.refresh()])
  return saved
}

// A DYE2 page, opened in place of Mono: DYE2 only allows its pages in frames of its own origin, and Mono is served
// from another port. DYE2 navigates to `return` when done; `back` is the query Mono reopens with (App reads it).
export const dye2PageUrl = (gatewayHttp: string, page: string, params: Record<string, string>, back: string) => {
  const q = new URLSearchParams({ ...params, return: `${location.origin}${location.pathname}${back}` })
  return `${gatewayHttp}${BASE}/${page}?${q}`
}

