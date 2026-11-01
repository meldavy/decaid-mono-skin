import type { Profile, ProfileStep } from '../domain/profile'

// de1app / Visualizer .tcl profiles: a Tcl list of key–value pairs. Values are bare words or {braced} groups
// (braces nest). `advanced_shot` is a list of stages, each itself a key–value list.

export function tclWords(text: string): string[] {
  const words: string[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    if (text[i] === '{') {
      let depth = 1
      const start = ++i
      while (i < text.length && depth > 0) {
        if (text[i] === '\\') i++
        else if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
        i++
      }
      if (depth !== 0) throw new Error('unbalanced braces')
      words.push(text.slice(start, i - 1))
    } else if (text[i] === '"') {
      const start = ++i
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++ }
      words.push(text.slice(start, i))
      i++
    } else {
      const start = i
      while (i < text.length && !/\s/.test(text[i])) i++
      words.push(text.slice(start, i))
    }
  }
  return words
}

export function tclDict(text: string): Record<string, string> {
  const w = tclWords(text)
  const out: Record<string, string> = {}
  for (let k = 0; k + 1 < w.length; k += 2) out[w[k]] = w[k + 1]
  return out
}

const num = (v: string | undefined, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

const BEVERAGES = new Set(['espresso', 'filter', 'pourover', 'tea_portafilter', 'manual', 'cleaning', 'calibrate'])

function stage(raw: Record<string, string>, i: number): ProfileStep {
  const pump = raw.pump === 'flow' ? 'flow' : 'pressure'
  const s: ProfileStep = {
    name: raw.name || `Stage ${i + 1}`,
    pump,
    pressure: pump === 'pressure' ? num(raw.pressure) : null,
    flow: pump === 'flow' ? num(raw.flow) : null,
    seconds: num(raw.seconds),
    transition: raw.transition === 'smooth' ? 'smooth' : 'fast',
    temperature: num(raw.temperature, 93),
    sensor: raw.sensor === 'water' ? 'water' : 'coffee',
    volume: num(raw.volume),
    weight: num(raw.weight),
    exit: null,
    limiter: num(raw.max_flow_or_pressure) > 0 ? { value: num(raw.max_flow_or_pressure), range: num(raw.max_flow_or_pressure_range, 0.6) } : null,
  }
  const type = raw.exit_type ?? ''
  if (num(raw.exit_if) !== 0 && /^(pressure|flow)_(over|under)$/.test(type)) {
    const [kind, condition] = type.split('_') as ['pressure' | 'flow', 'over' | 'under']
    s.exit = { type: kind, condition, value: num(raw[`exit_${type}`]) }
  }
  return s
}

// Throws an Error with a plain message when the file can't be imported.
export function parseTclProfile(text: string): Profile {
  let top: Record<string, string>
  try { top = tclDict(text) } catch { throw new Error("That file isn't a profile Mono can read.") }
  if (!top.profile_title && !top.advanced_shot) throw new Error("That file isn't a profile Mono can read.")
  const type = top.settings_profile_type ?? ''
  if (type && type !== 'settings_2c' && type !== 'settings_2c2') {
    throw new Error("Older “simple” de1app profiles can't be imported yet.")
  }
  const steps = tclWords(top.advanced_shot ?? '').map((s, i) => stage(tclDict(s), i))
  if (!steps.length) throw new Error("No stages Mono can read in that profile.")
  return {
    version: '2',
    title: top.profile_title || 'Imported profile',
    author: top.author ?? '',
    notes: top.profile_notes ?? '',
    beverage_type: BEVERAGES.has(top.beverage_type) ? top.beverage_type : 'espresso',
    steps,
    target_weight: num(top.final_desired_shot_weight_advanced) || num(top.final_desired_shot_weight) || 0,
    target_volume: num(top.final_desired_shot_volume_advanced) || 0,
    tank_temperature: num(top.tank_desired_water_temperature),
    target_volume_count_start: num(top.final_desired_shot_volume_advanced_count_start),
  } as Profile
}
