import type { PlannedStage } from './profile'

// A chart laid out stage by stage rather than by time: each stage gets a run of grid columns, in
// proportion to its planned seconds but never fewer than `minCols`, so a 2 s stage still has room for
// its name. When every stage fits, the stages fill `available` exactly; otherwise the total is wider
// and the caller scrolls.
export function stageColumns(seconds: number[], available: number, minCols: number): number[] {
  const n = seconds.length
  if (!n) return []
  const secs = seconds.map((s) => Math.max(0, s))
  if (n * minCols >= available) {
    // Too many stages to fit: long stages still get more room, at the rate the row would have had.
    const total = secs.reduce((a, b) => a + b, 0) || 1
    return secs.map((s) => Math.max(minCols, Math.round((s / total) * available)))
  }
  // Water-fill: stages that would be narrower than the minimum are pinned to it; the rest share what's left.
  const pinned = new Set<number>()
  let rate = 0
  for (;;) {
    const free = secs.reduce((a, s, i) => (pinned.has(i) ? a : a + s), 0)
    rate = free > 0 ? (available - pinned.size * minCols) / free : 0
    const more = secs.findIndex((s, i) => !pinned.has(i) && s * rate < minCols)
    if (more < 0 || rate === 0) break
    secs.forEach((s, i) => { if (!pinned.has(i) && s * rate < minCols) pinned.add(i) })
  }
  const exact = secs.map((s, i) => (pinned.has(i) || rate === 0 ? minCols : s * rate))
  const cols = exact.map((w) => Math.max(minCols, Math.floor(w)))
  // Hand the columns lost to rounding to the stages that lost the most.
  let left = available - cols.reduce((a, b) => a + b, 0)
  const order = exact.map((w, i) => [w - Math.floor(w), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && n; k = (k + 1) % n, left--) cols[order[k][1]]++
  return cols
}

export interface Lane { c0: number; c1: number; t0: number; t1: number }

// Where each stage's columns start and end, with its planned times.
export function lanes(stages: PlannedStage[], columns: number[]): Lane[] {
  let c = 0
  return stages.map((s, i) => { const lane = { c0: c, c1: c + (columns[i] ?? 0), t0: s.t0, t1: s.t1 }; c = lane.c1; return lane })
}

// The planned time at the middle of column `col`.
export function timeAtColumn(ls: Lane[], col: number): number {
  const lane = ls.find((l) => col < l.c1) ?? ls[ls.length - 1]
  if (!lane) return 0
  const frac = (col + 0.5 - lane.c0) / Math.max(1, lane.c1 - lane.c0)
  return lane.t0 + Math.min(1, frac) * (lane.t1 - lane.t0)
}

export function stageAtColumn(ls: Lane[], col: number): number {
  const i = ls.findIndex((l) => col < l.c1)
  return i < 0 ? ls.length - 1 : i
}

// The plan as the shot is actually running it. Stages end on weight, volume or pressure as often as on
// time, so the planned clock drifts from the real one. Stages the machine has left keep the time they
// really took; the current one runs from its real start for its planned length (or until now, if it's
// running long); the stages after it follow on. The ghosted plan then always continues from where the
// shot is. Samples need their `frame`; without them the plan is returned unchanged.
export function replan(stages: PlannedStage[], samples: { t: number; frame?: number }[]): PlannedStage[] {
  const last = samples[samples.length - 1]
  if (!stages.length || last?.frame === undefined) return stages
  const now = last.t
  const current = Math.min(stages.length - 1, Math.max(0, last.frame))
  const startOf = (i: number) => samples.find((s) => (s.frame ?? 0) >= i)?.t ?? now
  const out: PlannedStage[] = []
  let t = 0
  stages.forEach((s, i) => {
    const length = s.t1 - s.t0
    let t0: number
    let t1: number
    if (i < current) { t0 = startOf(i); t1 = startOf(i + 1) }
    else if (i === current) { t0 = startOf(i); t1 = Math.max(t0 + length, now) }
    else { t0 = t; t1 = t + length }
    out.push({ ...s, t0, t1 })
    t = t1
  })
  return out
}
