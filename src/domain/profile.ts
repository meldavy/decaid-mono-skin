// Decent v2 profile JSON, as stored by Decaid.

export interface ProfileStep {
  name: string
  pump: 'pressure' | 'flow'
  pressure: number | null
  flow: number | null
  seconds: number
  transition: 'fast' | 'smooth'
  temperature?: number
  sensor?: 'coffee' | 'water'
  exit?: { type: 'pressure' | 'flow'; condition: 'over' | 'under'; value: number } | null
  limiter?: { value: number; range: number } | null
  volume?: number
  weight?: number | null
}

export interface Profile {
  title: string
  author?: string
  notes?: string
  beverage_type?: string
  steps: ProfileStep[]
  target_weight?: number | null
  target_volume?: number | null
  [key: string]: unknown
}

export interface ProfileRecord {
  id: string
  profile: Profile
  isDefault: boolean
  visibility: 'visible' | 'hidden' | 'deleted' | string
  parentId?: string | null
}

export const MAX_PLANNED_STEP = 20 // s: a step's `seconds` is a ceiling, so long steps are drawn capped
export const MIN_PLANNED_STEP = 1 // s: zero-length steps still get a visible slot

export interface PlannedStage {
  index: number
  name: string
  pump: 'pressure' | 'flow'
  t0: number
  t1: number
  from: number // controlled value at stage start
  to: number // controlled value at stage end
  limit: number | null // the other quantity's cap: flow limit on a pressure step, pressure limit on a flow step
}

export function stepTarget(step: ProfileStep): number {
  return (step.pump === 'flow' ? step.flow : step.pressure) ?? 0
}

// Lays the profile out on a time axis: the plan the live shot fills in.
// Stages are worked out once per profile object (profiles are replaced, never changed in place), so a chart
// redrawn for an unrelated reason doesn't recompute them.
const planned = new WeakMap<object, PlannedStage[]>()
export function planStages(profile: Pick<Profile, 'steps'>): PlannedStage[] {
  const cached = planned.get(profile)
  if (cached) return cached
  const stages = computeStages(profile)
  planned.set(profile, stages)
  return stages
}

function computeStages(profile: Pick<Profile, 'steps'>): PlannedStage[] {
  const stages: PlannedStage[] = []
  let t = 0
  let previous: { pump: string; value: number } | null = null
  profile.steps.forEach((step, index) => {
    const duration = Math.min(MAX_PLANNED_STEP, Math.max(MIN_PLANNED_STEP, step.seconds || 0))
    const target = stepTarget(step)
    // A smooth transition ramps from the previous value of the same kind; otherwise it jumps.
    const from = step.transition === 'smooth' && previous?.pump === step.pump ? previous.value : target
    const limit = step.limiter && step.limiter.value > 0 ? step.limiter.value : null
    stages.push({ index, name: step.name, pump: step.pump, t0: t, t1: t + duration, from, to: target, limit })
    t += duration
    previous = { pump: step.pump, value: target }
  })
  return stages
}

export function plannedValueAt(stages: PlannedStage[], t: number): { stage: PlannedStage; value: number } | null {
  const stage = stages.find((s) => t < s.t1) ?? stages[stages.length - 1]
  if (!stage) return null
  const u = Math.min(1, Math.max(0, (t - stage.t0) / (stage.t1 - stage.t0)))
  return { stage, value: stage.from + (stage.to - stage.from) * u }
}

export function plannedDuration(stages: PlannedStage[]): number {
  return stages.length ? stages[stages.length - 1].t1 : 0
}

// Proportional widths for the stage timeline, as fractions summing to 1.
export function stageWidths(stages: PlannedStage[]): number[] {
  const total = plannedDuration(stages)
  return total ? stages.map((s) => (s.t1 - s.t0) / total) : []
}

// Planned pressure and flow at time t: the controlled quantity follows the step, the other shows its limit
// (null when the step sets no limit, so the chart leaves a gap rather than inventing a curve).
export function plannedSeriesAt(stages: PlannedStage[], t: number): { pressure: number | null; flow: number | null; stage: PlannedStage } | null {
  const at = plannedValueAt(stages, t)
  if (!at) return null
  const { stage, value } = at
  return stage.pump === 'pressure'
    ? { pressure: value, flow: stage.limit, stage }
    : { pressure: stage.limit, flow: value, stage }
}
