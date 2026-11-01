import type { Profile, ProfileStep } from './profile'

// Pure profile-editing rules for the editor.

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export type StageField = 'target' | 'seconds' | 'limit' | 'temperature' | 'exitWeight' | 'exitVolume' | 'exitPressure' | 'exitFlow'

export interface FieldSpec { label: string; unit: string; min: number; max: number; step: number; decimals: number; offable: boolean }

export function fieldSpec(field: StageField, step: ProfileStep): FieldSpec {
  const pressure = step.pump === 'pressure'
  switch (field) {
    case 'target': return pressure ? { label: 'PRESSURE AT END OF STAGE', unit: 'BAR', min: 0, max: 12, step: 0.1, decimals: 1, offable: false } : { label: 'FLOW AT END OF STAGE', unit: 'ML/S', min: 0, max: 10, step: 0.1, decimals: 1, offable: false }
    case 'seconds': return { label: 'DURATION', unit: 'S', min: 0, max: 127, step: 1, decimals: 0, offable: false }
    case 'limit': return pressure ? { label: 'MAX FLOW', unit: 'ML/S', min: 0, max: 10, step: 0.1, decimals: 1, offable: true } : { label: 'MAX PRESSURE', unit: 'BAR', min: 0, max: 12, step: 0.1, decimals: 1, offable: true }
    case 'temperature': return { label: 'TEMPERATURE', unit: '°C', min: 80, max: 105, step: 0.5, decimals: 1, offable: false }
    case 'exitWeight': return { label: 'WEIGHT REACHES', unit: 'G', min: 0.5, max: 250, step: 0.5, decimals: 1, offable: true }
    case 'exitVolume': return { label: 'VOLUME REACHES', unit: 'ML', min: 1, max: 500, step: 1, decimals: 0, offable: true }
    // One row for the pressure (or flow) condition: above or below is part of its value, not a second row.
    case 'exitPressure': return { label: `PRESSURE${exitLabel(step, 'pressure')}`, unit: 'BAR', min: 0.1, max: 12, step: 0.1, decimals: 1, offable: true }
    case 'exitFlow': return { label: `FLOW${exitLabel(step, 'flow')}`, unit: 'ML/S', min: 0.1, max: 10, step: 0.1, decimals: 1, offable: true }
  }
}

type ExitType = 'pressure' | 'flow'
const EXIT: Partial<Record<StageField, ExitType>> = { exitPressure: 'pressure', exitFlow: 'flow' }
const exitLabel = (step: ProfileStep, type: ExitType) => (step.exit?.type === type ? (step.exit.condition === 'over' ? ' ABOVE' : ' BELOW') : '')

// The direction of a stage's pressure or flow condition: its current one, or "above" when there is none.
export const exitCondition = (step: ProfileStep, type: ExitType): 'over' | 'under' => (step.exit?.type === type ? step.exit.condition : 'over')

// Set (or clear, with null) the stage's pressure or flow condition. A stage has only one: setting it replaces it.
export function writeExit(step: ProfileStep, type: ExitType, condition: 'over' | 'under', value: number | null): ProfileStep {
  const s = clone(step)
  if (value === null) { if (s.exit?.type === type) s.exit = null }
  else s.exit = { type, condition, value }
  return s
}

// Current value of a field, or null when it's off.
export function readField(step: ProfileStep, field: StageField): number | null {
  switch (field) {
    case 'target': return (step.pump === 'pressure' ? step.pressure : step.flow) ?? 0
    case 'seconds': return step.seconds
    case 'limit': return step.limiter && step.limiter.value > 0 ? step.limiter.value : null
    case 'temperature': return step.temperature ?? 93
    case 'exitWeight': return step.weight && step.weight > 0 ? step.weight : null
    case 'exitVolume': return step.volume && step.volume > 0 ? step.volume : null
    default: return step.exit?.type === EXIT[field] ? step.exit!.value : null
  }
}

// A stage with one field set (null = off). Only one pressure / flow exit can be active at a time.
export function writeField(step: ProfileStep, field: StageField, value: number | null): ProfileStep {
  const s = clone(step)
  switch (field) {
    case 'target': if (s.pump === 'pressure') s.pressure = value ?? 0; else s.flow = value ?? 0; break
    case 'seconds': s.seconds = value ?? 0; break
    case 'limit': s.limiter = { value: value ?? 0, range: s.limiter?.range ?? 0.6 }; break
    case 'temperature': s.temperature = value ?? s.temperature; break
    case 'exitWeight': s.weight = value ?? 0; break
    case 'exitVolume': s.volume = value ?? 0; break
    default: return writeExit(s, EXIT[field]!, exitCondition(s, EXIT[field]!), value)
  }
  return s
}

// Switching control keeps the stage meaningful: the old target becomes the limit's opposite default.
export function setPump(step: ProfileStep, pump: 'pressure' | 'flow'): ProfileStep {
  if (step.pump === pump) return step
  const s = clone(step)
  s.pump = pump
  if (pump === 'pressure') { s.pressure = s.pressure ?? 6; s.flow = null } else { s.flow = s.flow ?? 2; s.pressure = null }
  return s
}

export function addStageAfter(p: Profile, index: number): Profile {
  const n = clone(p)
  const base = n.steps[index] ?? n.steps[n.steps.length - 1]
  const fresh: ProfileStep = { ...clone(base), name: `Stage ${n.steps.length + 1}`, exit: null, weight: 0, volume: 0, transition: 'fast' }
  n.steps.splice(index + 1, 0, fresh)
  return n
}

export function duplicateStage(p: Profile, index: number): Profile {
  const n = clone(p)
  n.steps.splice(index + 1, 0, { ...clone(n.steps[index]), name: `${n.steps[index].name} 2`.trim() })
  return n
}

export function deleteStage(p: Profile, index: number): Profile {
  if (p.steps.length <= 1) return p
  const n = clone(p)
  n.steps.splice(index, 1)
  return n
}

// Move the stage at `from` so it ends up at `to` (the stages between shift over).
export function moveStage(p: Profile, from: number, to: number): Profile {
  if (from === to || from < 0 || to < 0 || from >= p.steps.length || to >= p.steps.length) return p
  const n = clone(p)
  const [s] = n.steps.splice(from, 1)
  n.steps.splice(to, 0, s)
  return n
}

// Why a profile can't be saved yet, or null.
export function saveProblem(p: Profile): string | null {
  if (!p.title.trim()) return 'Give the profile a name.'
  const instant = p.steps.findIndex((s) => !s.seconds && !s.exit && !(s.weight && s.weight > 0) && !(s.volume && s.volume > 0))
  if (instant >= 0) return `Stage ${instant + 1} has no duration and nothing to move on — it would end at once.`
  return null
}

export interface Change { what: string; from: string; to: string }
const fmt = (v: unknown) => (v === null || v === undefined || v === '' || v === 0 ? '—' : typeof v === 'number' ? String(Number(v.toFixed(2))) : String(v))

// A readable list of what changed, for the unsaved-changes dialog.
export function profileChanges(before: Profile, after: Profile): Change[] {
  const out: Change[] = []
  if (before.title !== after.title) out.push({ what: 'Name', from: fmt(before.title), to: fmt(after.title) })
  if ((before.beverage_type ?? '') !== (after.beverage_type ?? '')) out.push({ what: 'Type', from: fmt(before.beverage_type), to: fmt(after.beverage_type) })
  if ((before.target_weight ?? 0) !== (after.target_weight ?? 0)) out.push({ what: 'Target yield', from: fmt(before.target_weight), to: fmt(after.target_weight) })
  if (String(before.version ?? '') !== String(after.version ?? '')) out.push({ what: 'Version', from: fmt(before.version), to: fmt(after.version) })
  if ((before.notes ?? '') !== (after.notes ?? '')) out.push({ what: 'Notes', from: before.notes ? 'edited' : '—', to: after.notes ? 'edited' : '—' })
  if (before.steps.length !== after.steps.length) out.push({ what: 'Stages', from: String(before.steps.length), to: String(after.steps.length) })
  const n = Math.min(before.steps.length, after.steps.length)
  const fields: [keyof ProfileStep, string][] = [['name', 'name'], ['pump', 'control'], ['pressure', 'pressure'], ['flow', 'flow'], ['seconds', 'duration'], ['transition', 'transition'], ['temperature', 'temperature'], ['sensor', 'measure from'], ['weight', 'exit weight'], ['volume', 'exit volume']]
  for (let i = 0; i < n; i++) {
    const a = before.steps[i], b = after.steps[i]
    for (const [k, label] of fields) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push({ what: `${b.name || `Stage ${i + 1}`} · ${label}`, from: fmt(a[k]), to: fmt(b[k]) })
    if ((a.limiter?.value ?? 0) !== (b.limiter?.value ?? 0)) out.push({ what: `${b.name || `Stage ${i + 1}`} · limit`, from: fmt(a.limiter?.value), to: fmt(b.limiter?.value) })
    if (JSON.stringify(a.exit ?? null) !== JSON.stringify(b.exit ?? null)) out.push({ what: `${b.name || `Stage ${i + 1}`} · move-on`, from: a.exit ? `${a.exit.type} ${a.exit.condition} ${a.exit.value}` : '—', to: b.exit ? `${b.exit.type} ${b.exit.condition} ${b.exit.value}` : '—' })
  }
  return out
}

export const BEVERAGE_TYPES = ['espresso', 'filter', 'pourover', 'tea_portafilter', 'manual', 'cleaning', 'calibrate'] as const
export const beverageLabel = (t: string | undefined) => ({ espresso: 'Espresso', filter: 'Filter', pourover: 'Pour over', tea_portafilter: 'Tea', manual: 'Manual', cleaning: 'Cleaning', calibrate: 'Calibrate' } as Record<string, string>)[t ?? ''] ?? 'Espresso'

// A copy gets a version of its own, so it's a distinct profile in Decaid even before its recipe changes
// (Decaid's profile id includes the version). "2" → "2.1", "2.1" → "2.2", anything else gets " copy".
export function nextVersion(version: string | undefined | null, taken: string[] = []): string {
  const v = String(version ?? '').trim() || '2'
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v)
  let next = m ? `${m[1]}.${Number(m[2] ?? 0) + 1}` : `${v} copy`
  while (taken.includes(next)) {
    const n = /^(\d+)\.(\d+)$/.exec(next)
    next = n ? `${n[1]}.${Number(n[2]) + 1}` : `${next} 2`
  }
  return next
}
