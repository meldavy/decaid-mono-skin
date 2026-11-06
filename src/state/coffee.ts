import { api } from '../api/client'
import { createResource } from './resource'
import { saveWorkflow, type Workflow } from './workflow'

// Beans, their bags (Decaid calls them batches) and grinders: Decaid's own records, the same ones DYE2 edits.
// Archived records are loaded too; screens decide what to show.

export interface Bean {
  id: string
  roaster: string
  name: string
  decaf: boolean
  species?: string | null
  decafProcess?: string | null
  country?: string | null
  region?: string | null
  producer?: string | null
  variety?: string[] | null
  altitude?: number[] | null // [min, max] m
  processing?: string | null
  notes?: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Bag {
  id: string
  beanId: string
  roastDate?: string | null
  roastLevel?: string | null
  weight?: number | null
  weightRemaining?: number | null
  frozen: boolean
  notes?: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Grinder {
  id: string
  model: string
  burrs?: string | null
  burrSize?: number | null
  burrType?: string | null
  notes?: string | null
  archived: boolean
  settingType: 'numeric' | 'preset'
  createdAt: string
  updatedAt: string
}

export type BeanFields = Omit<Bean, 'id' | 'archived' | 'createdAt' | 'updatedAt'>
export type BagFields = Pick<Bag, 'roastDate' | 'roastLevel' | 'weight' | 'notes'>
export type GrinderFields = Pick<Grinder, 'model' | 'burrs' | 'burrSize' | 'burrType' | 'notes'>

export const beans = createResource(() => api.get<Bean[]>('/api/v1/beans?includeArchived=true'), 30_000)
export const bags = createResource(() => api.get<Bag[]>('/api/v1/bean-batches?includeArchived=true'), 30_000)
export const grinders = createResource(() => api.get<Grinder[]>('/api/v1/grinders?includeArchived=true'), 30_000)

const id = (x: string) => encodeURIComponent(x)

export async function createBean(fields: BeanFields) {
  const bean = await api.post<Bean>('/api/v1/beans', fields)
  await beans.refresh()
  return bean
}
export async function updateBean(beanId: string, patch: Partial<BeanFields> & { archived?: boolean }) {
  await api.put(`/api/v1/beans/${id(beanId)}`, patch)
  await beans.refresh()
}
// Decaid won't delete a bean that still has bags, so its bags go first.
export async function deleteBean(beanId: string) {
  const own = (bags.get().value ?? []).filter((b) => b.beanId === beanId)
  for (const bag of own) await api.del(`/api/v1/bean-batches/${id(bag.id)}`)
  await api.del(`/api/v1/beans/${id(beanId)}`)
  await Promise.all([beans.refresh(), bags.refresh()])
}

export async function createBag(beanId: string, fields: BagFields) {
  const bag = await api.post<Bag>(`/api/v1/beans/${id(beanId)}/batches`, fields)
  await bags.refresh()
  return bag
}
export async function updateBag(bagId: string, patch: Partial<BagFields> & { archived?: boolean }) {
  await api.put(`/api/v1/bean-batches/${id(bagId)}`, patch)
  await bags.refresh()
}
export async function deleteBag(bagId: string) {
  await api.del(`/api/v1/bean-batches/${id(bagId)}`)
  await bags.refresh()
}

export async function createGrinder(fields: GrinderFields) {
  const grinder = await api.post<Grinder>('/api/v1/grinders', fields)
  await grinders.refresh()
  return grinder
}
export async function updateGrinder(grinderId: string, patch: Partial<GrinderFields> & { archived?: boolean }) {
  await api.put(`/api/v1/grinders/${id(grinderId)}`, patch)
  await grinders.refresh()
}
export async function deleteGrinder(grinderId: string) {
  await api.del(`/api/v1/grinders/${id(grinderId)}`)
  await grinders.refresh()
}

// ── Next shot ────────────────────────────────────────────────────────────────────────────────────────

// Decaid stores only the links; the names travel with them so a shot reads right even after the bean is gone.
export const coffeeContext = (bean: Bean | null, bag: Bag | null) => ({
  beanBatchId: bag?.id ?? null,
  coffeeName: bean?.name ?? null,
  coffeeRoaster: bean?.roaster ?? null,
})
export const grinderContext = (grinder: Grinder | null) => ({
  grinderId: grinder?.id ?? null,
  grinderModel: grinder?.model ?? null,
})

export const chooseBag = (bean: Bean | null, bag: Bag | null) => saveWorkflow({ context: coffeeContext(bean, bag) })
export const chooseGrinder = (grinder: Grinder | null) => saveWorkflow({ context: grinderContext(grinder) })
export const setGrind = (setting: string) => saveWorkflow({ context: { grinderSetting: setting || null } as Workflow['context'] })

// A bean's bags in use, newest roast first (bags without a roast date last, newest added first).
export function liveBags(all: Bag[], beanId: string) {
  return all
    .filter((b) => b.beanId === beanId && !b.archived)
    .sort((a, b) => String(b.roastDate ?? '').localeCompare(String(a.roastDate ?? '')) || b.createdAt.localeCompare(a.createdAt))
}

// Whole days since roasting, by calendar date, so a bag roasted yesterday evening is 1 day old this morning.
export function roastAge(roastDate: string | null | undefined, now: Date) {
  if (!roastDate) return undefined
  const roasted = new Date(roastDate)
  if (Number.isNaN(roasted.getTime())) return undefined
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.max(0, Math.round((day(now) - day(roasted)) / 86_400_000))
}

// What the next shot uses, resolved against the records. A link to something since deleted falls back to the names.
export function nextCoffee(context: Record<string, unknown> | undefined, all: { beans: Bean[]; bags: Bag[]; grinders: Grinder[] }) {
  const str = (k: string) => (typeof context?.[k] === 'string' && (context[k] as string).trim() ? (context[k] as string).trim() : undefined)
  const bag = all.bags.find((b) => b.id === str('beanBatchId'))
  const bean = bag ? all.beans.find((b) => b.id === bag.beanId) : undefined
  const grinder = all.grinders.find((g) => g.id === str('grinderId'))
  return {
    bag,
    bean,
    grinder,
    coffee: bean?.name ?? str('coffeeName'),
    roaster: bean?.roaster ?? str('coffeeRoaster'),
    grinderName: grinder?.model ?? str('grinderModel'),
    grind: str('grinderSetting'),
  }
}
