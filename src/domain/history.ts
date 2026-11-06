import type { ShotSample } from '../ui/DotChart'

// A stored shot from Decaid (GET /shots?ids= or /shots/{id}), and what History shows from it.
export interface StoredMeasurement {
  machine: { timestamp: string; state: { state: string; substate: string }; pressure: number; flow: number }
  scale?: { weight?: number | null } | null
  volume?: number | null
}

export interface StoredShot {
  id: string
  timestamp: string
  stopReason?: string | null
  annotations?: { actualDoseWeight?: number | null; actualYield?: number | null; enjoyment?: number | null; espressoNotes?: string | null } | null
  workflow?: {
    profile?: { title: string; steps?: unknown[] }
    context?: { targetDoseWeight?: number | null; targetYield?: number | null; grinderSetting?: string | null; coffeeName?: string | null; coffeeRoaster?: string | null } | null
  } | null
  measurements?: StoredMeasurement[]
}

export interface ShotSummary {
  samples: ShotSample[]
  duration: number | null // seconds poured
  yield: number | null // g
  dose: number | null // g
  ratio: number | null // yield / dose
  peakPressure: number | null
}

const POURING = ['preinfusion', 'pouring', 'pouringDone']

export function summarize(shot: StoredShot): ShotSummary {
  const ms = shot.measurements ?? []
  const pour = ms.filter((m) => m.machine.state.state === 'espresso' && POURING.includes(m.machine.state.substate))
  const t0 = pour.length ? Date.parse(pour[0].machine.timestamp) : NaN
  const samples = pour.map((m) => ({ t: (Date.parse(m.machine.timestamp) - t0) / 1000, pressure: m.machine.pressure, flow: m.machine.flow }))
  const duration = samples.length ? samples[samples.length - 1].t : null
  const weights = ms.map((m) => m.scale?.weight).filter((w): w is number => typeof w === 'number' && Number.isFinite(w))
  const measured = weights.length ? Math.max(...weights) : null
  const yieldG = shot.annotations?.actualYield ?? (measured && measured > 0.5 ? measured : null)
  const dose = shot.annotations?.actualDoseWeight ?? shot.workflow?.context?.targetDoseWeight ?? null
  const peak = samples.length ? Math.max(...samples.map((s) => s.pressure)) : null
  return { samples, duration, yield: yieldG, dose, ratio: yieldG && dose ? yieldG / dose : null, peakPressure: peak }
}

export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// TODAY, YESTERDAY, then "THU 10 SEP" (with the year once it isn't this year).
export function dayLabel(date: Date, now: Date) {
  if (dayKey(date) === dayKey(now)) return 'TODAY'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(y)) return 'YESTERDAY'
  const base = `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`
}

// Groups shots (already newest first) into consecutive days.
export function groupByDay<T extends { timestamp: string }>(shots: T[], now: Date): { label: string; shots: T[] }[] {
  const out: { key: string; label: string; shots: T[] }[] = []
  for (const s of shots) {
    const d = new Date(s.timestamp)
    const key = dayKey(d)
    const last = out[out.length - 1]
    if (last?.key === key) last.shots.push(s)
    else out.push({ key, label: dayLabel(d, now), shots: [s] })
  }
  return out.map(({ label, shots: list }) => ({ label, shots: list }))
}

export function beanLine(shot: StoredShot, dose: number | null) {
  const c = shot.workflow?.context
  const bean = [c?.coffeeRoaster, c?.coffeeName].filter((x) => x && x.trim()).join(', ')
  return [bean, dose ? `${dose.toFixed(1)} g in` : ''].filter(Boolean).join(' · ')
}

// Home's line under a profile name: when it was last brewed and how that shot rated.
// `all`: the shots looked at are every shot there is, so none means never.
export function lastShotLine(shot: StoredShot | undefined, all: boolean, now: Date) {
  if (!shot) return all ? 'Not brewed yet' : 'Not brewed recently'
  const day = dayLabel(new Date(shot.timestamp), now)
  const rating = shot.annotations?.enjoyment ? `, rated ${Math.round(shot.annotations.enjoyment / 2)}/5` : ''
  const when = day === 'TODAY' || day === 'YESTERDAY' ? day.toLowerCase() : `on ${titleCase(day)}`
  return `Last brewed ${when}${rating}`
}

const titleCase = (label: string) => label.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
