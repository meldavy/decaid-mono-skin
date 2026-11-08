// Adjustable values: limits, steps and how each is read from / written to Decaid.
import type { Profile } from '../domain/profile'
import type { Workflow, WorkflowPatch } from '../state/workflow'

export type ValueId =
  | 'espressoTemp' | 'hotWaterTemp' | 'steamTemp' | 'milkTemp'
  | 'dose' | 'espressoYield' | 'hotWaterAmount'
  | 'shotTarget' | 'hotWaterMax' | 'steamMax' | 'flushTime'

export interface ValueSpec {
  id: ValueId
  label: string // tab label, without unit
  unit: 'temp' | 'g' | 'ml' | 's'
  min: number
  max: number
  step: number
  decimals: number
  presets: number[]
  off?: number // a value meaning "off" (steam heater: 0)
  where: 'profile' | 'workflow' | 'mono'
}

export const VALUES: Record<ValueId, ValueSpec> = {
  espressoTemp: { id: 'espressoTemp', label: 'ESPRESSO', unit: 'temp', min: 80, max: 100, step: 0.5, decimals: 1, presets: [88, 90, 92, 94, 96], where: 'profile' },
  hotWaterTemp: { id: 'hotWaterTemp', label: 'HOT WATER', unit: 'temp', min: 40, max: 100, step: 1, decimals: 0, presets: [70, 75, 80, 85, 90], where: 'workflow' },
  steamTemp: { id: 'steamTemp', label: 'STEAM', unit: 'temp', min: 135, max: 160, step: 1, decimals: 0, presets: [140, 145, 150, 155, 160], off: 0, where: 'workflow' },
  // Steam stops when the milk reaches this (Decaid's stop-at-temperature; 0 = off). Decaid accepts 0–80 °C.
  milkTemp: { id: 'milkTemp', label: 'MILK', unit: 'temp', min: 40, max: 80, step: 1, decimals: 0, presets: [55, 60, 62, 65], off: 0, where: 'workflow' },
  dose: { id: 'dose', label: 'DOSE', unit: 'g', min: 5, max: 30, step: 0.1, decimals: 1, presets: [16, 17, 18, 19, 20], where: 'profile' },
  // Allongés run well past 100 g.
  espressoYield: { id: 'espressoYield', label: 'ESPRESSO', unit: 'g', min: 10, max: 250, step: 0.1, decimals: 1, presets: [32, 36, 40, 45, 50], where: 'profile' },
  hotWaterAmount: { id: 'hotWaterAmount', label: 'HOT WATER', unit: 'ml', min: 10, max: 500, step: 5, decimals: 0, presets: [100, 150, 200, 250, 350], where: 'workflow' },
  shotTarget: { id: 'shotTarget', label: 'SHOT TARGET', unit: 's', min: 10, max: 60, step: 1, decimals: 0, presets: [25, 28, 30, 35, 40], where: 'mono' },
  hotWaterMax: { id: 'hotWaterMax', label: 'HOT WATER MAX', unit: 's', min: 5, max: 120, step: 1, decimals: 0, presets: [20, 30, 45, 60, 90], where: 'workflow' },
  steamMax: { id: 'steamMax', label: 'STEAM MAX', unit: 's', min: 5, max: 120, step: 1, decimals: 0, presets: [20, 30, 45, 60, 90], where: 'workflow' },
  flushTime: { id: 'flushTime', label: 'FLUSH', unit: 's', min: 1, max: 30, step: 1, decimals: 0, presets: [3, 5, 8, 10, 15], where: 'workflow' },
}

export const SHEETS = {
  temp: ['espressoTemp', 'hotWaterTemp', 'steamTemp', 'milkTemp'],
  dose: ['dose'],
  yield: ['espressoYield', 'hotWaterAmount'],
  time: ['shotTarget', 'hotWaterMax', 'steamMax', 'flushTime'],
} as const satisfies Record<string, readonly ValueId[]>

export type SheetKind = keyof typeof SHEETS

export function snap(value: number, spec: ValueSpec): number {
  if (spec.off !== undefined && value === spec.off) return value
  const clamped = Math.min(spec.max, Math.max(spec.min, value))
  const stepped = Math.round((clamped - spec.min) / spec.step) * spec.step + spec.min
  return Number(stepped.toFixed(spec.decimals))
}

export function readValue(id: ValueId, wf: Workflow, shotTarget: number): number {
  switch (id) {
    case 'espressoTemp': return wf.profile.steps[0]?.temperature ?? 0
    case 'hotWaterTemp': return wf.hotWaterData.targetTemperature
    case 'steamTemp': return wf.steamSettings.targetTemperature < 135 ? 0 : wf.steamSettings.targetTemperature
    case 'milkTemp': { const v = wf.steamSettings.stopAtTemperature ?? 0; return v < 40 ? 0 : Math.min(80, v) }
    case 'dose': return wf.context?.targetDoseWeight ?? 0
    case 'espressoYield': return wf.context?.targetYield ?? 0
    case 'hotWaterAmount': return wf.hotWaterData.volume
    case 'shotTarget': return shotTarget
    case 'hotWaterMax': return wf.hotWaterData.duration
    case 'steamMax': return wf.steamSettings.duration
    case 'flushTime': return wf.rinseData.duration
  }
}

// Every step's temperature moves by the same amount, so a profile's temperature shape is kept.
export function shiftProfileTemperature(profile: Profile, to: number): Profile {
  const from = profile.steps[0]?.temperature ?? to
  const delta = to - from
  return { ...profile, steps: profile.steps.map((s) => ({ ...s, temperature: Number(((s.temperature ?? from) + delta).toFixed(1)) })) }
}

// One partial workflow update for all changed workflow / profile values.
export function workflowPatch(changes: Partial<Record<ValueId, number>>, wf: Workflow): WorkflowPatch {
  const patch: WorkflowPatch = {}
  const set = <K extends 'context' | 'steamSettings' | 'hotWaterData' | 'rinseData'>(key: K, field: string, value: number) => {
    patch[key] = { ...(patch[key] as object), [field]: value } as WorkflowPatch[K]
  }
  for (const [id, v] of Object.entries(changes) as [ValueId, number][]) {
    switch (id) {
      case 'espressoTemp': patch.profile = shiftProfileTemperature(wf.profile, v); break
      case 'hotWaterTemp': set('hotWaterData', 'targetTemperature', v); break
      case 'steamTemp': set('steamSettings', 'targetTemperature', v); break
      case 'milkTemp': set('steamSettings', 'stopAtTemperature', v); break
      case 'dose': set('context', 'targetDoseWeight', v); break
      case 'espressoYield': set('context', 'targetYield', v); break
      case 'hotWaterAmount': set('hotWaterData', 'volume', v); break
      case 'hotWaterMax': set('hotWaterData', 'duration', v); break
      case 'steamMax': set('steamSettings', 'duration', v); break
      case 'flushTime': set('rinseData', 'duration', v); break
      case 'shotTarget': break // Mono's store, not the workflow
    }
  }
  return patch
}

// The same spec expressed in the units shown to the person. Temperatures in °F step by whole degrees.
export function inUnits(spec: ValueSpec, units: 'c' | 'f'): ValueSpec {
  if (spec.unit !== 'temp' || units === 'c') return spec
  const f = (c: number) => Math.round(c * 9 / 5 + 32)
  return { ...spec, min: f(spec.min), max: f(spec.max), step: 1, decimals: 0, presets: spec.presets.map(f) }
}

export const toShown = (spec: ValueSpec, units: 'c' | 'f', celsius: number) =>
  spec.unit === 'temp' && units === 'f' && celsius !== spec.off ? Math.round(celsius * 9 / 5 + 32) : celsius
export const fromShown = (spec: ValueSpec, units: 'c' | 'f', shown: number) =>
  spec.unit === 'temp' && units === 'f' && shown !== spec.off ? Number(((shown - 32) * 5 / 9).toFixed(1)) : shown

export const ratio = (yieldG: number, dose: number) => (dose > 0 ? `1:${(yieldG / dose).toFixed(1)}` : '—')
