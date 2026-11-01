import type { ProfileStep } from './profile'

// Which of a stage's exit conditions the progress bar follows: whichever looks set to finish first.
// A stage can end on its time limit, a weight, a volume, or a pressure / flow threshold.

export interface StageSample { t: number; pressure: number; flow: number; weight?: number }

export interface StageProgress {
  kind: 'time' | 'weight' | 'volume' | 'pressure' | 'flow'
  progress: number // 0–1
  eta: number // seconds left at the current rate; Infinity when not moving towards it
  label: string // e.g. "10.4 S OF 12", "12.1 G OF 20 G", "2.6 → 3.0 BAR"
}

const RATE_WINDOW = 1.5 // s of recent samples used for the rate
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function slope(samples: StageSample[], pick: (s: StageSample) => number | undefined): number {
  const last = samples[samples.length - 1]
  if (!last) return 0
  const window = samples.filter((s) => last.t - s.t <= RATE_WINDOW && pick(s) !== undefined)
  if (window.length < 2) return 0
  const a = window[0]
  const dt = last.t - a.t
  return dt > 0 ? (pick(last)! - pick(a)!) / dt : 0
}

// `samples` are this stage's samples (t in shot seconds); `inStage` is seconds spent in the stage.
export function stageProgressOptions(step: ProfileStep, samples: StageSample[], inStage: number): StageProgress[] {
  const options: StageProgress[] = []
  const first = samples[0]
  const last = samples[samples.length - 1]

  if (step.seconds > 0) {
    options.push({ kind: 'time', progress: clamp01(inStage / step.seconds), eta: Math.max(0, step.seconds - inStage), label: `${inStage.toFixed(1)} S OF ${Math.round(step.seconds)}` })
  }
  if (step.weight && step.weight > 0 && first?.weight !== undefined && last?.weight !== undefined) {
    const gained = Math.max(0, last.weight - first.weight)
    const rate = slope(samples, (s) => s.weight)
    options.push({ kind: 'weight', progress: clamp01(gained / step.weight), eta: rate > 0.05 ? Math.max(0, (step.weight - gained) / rate) : Infinity, label: `${gained.toFixed(1)} G OF ${step.weight.toFixed(0)} G` })
  }
  if (step.volume && step.volume > 0 && samples.length > 1) {
    let vol = 0
    for (let i = 1; i < samples.length; i++) vol += samples[i].flow * (samples[i].t - samples[i - 1].t)
    const flow = last.flow
    options.push({ kind: 'volume', progress: clamp01(vol / step.volume), eta: flow > 0.05 ? Math.max(0, (step.volume - vol) / flow) : Infinity, label: `${vol.toFixed(0)} ML OF ${step.volume.toFixed(0)} ML` })
  }
  if (step.exit && first && last) {
    const { type, condition, value } = step.exit
    const pick = (s: StageSample) => (type === 'pressure' ? s.pressure : s.flow)
    const v0 = pick(first)
    const v = pick(last)
    const rate = slope(samples, pick)
    const unit = type === 'pressure' ? 'BAR' : 'ML/S'
    const towards = condition === 'over' ? rate : -rate
    const span = condition === 'over' ? value - v0 : v0 - value
    const done = condition === 'over' ? v - v0 : v0 - v
    options.push({
      kind: type,
      progress: span > 0 ? clamp01(done / span) : (condition === 'over' ? v >= value : v <= value) ? 1 : 0,
      eta: towards > 0.02 ? Math.max(0, Math.abs(value - v) / towards) : Infinity,
      label: `${v.toFixed(1)} → ${value.toFixed(1)} ${unit}`,
    })
  }
  return options
}

export function stageProgress(step: ProfileStep, samples: StageSample[], inStage: number): StageProgress | null {
  const options = stageProgressOptions(step, samples, inStage)
  if (!options.length) return null
  const moving = options.filter((o) => Number.isFinite(o.eta))
  if (moving.length) return moving.reduce((a, b) => (b.eta < a.eta ? b : a))
  return options.find((o) => o.kind === 'time') ?? options.reduce((a, b) => (b.progress > a.progress ? b : a))
}
