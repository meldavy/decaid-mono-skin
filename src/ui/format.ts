import type { Prefs } from '../state/prefs'

export const toUnit = (celsius: number, units: Prefs['units']) => (units === 'f' ? celsius * 9 / 5 + 32 : celsius)
export const fromUnit = (value: number, units: Prefs['units']) => (units === 'f' ? (value - 32) * 5 / 9 : value)
export const tempLabel = (units: Prefs['units']) => (units === 'f' ? '°F' : '°C')

// '--' rather than an em dash: the dot font draws '—' as a row of five squares.
export const NONE = '--'

export function fixed(value: number | null | undefined, digits: number, fallback = NONE) {
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value.toFixed(digits)
}

export function clock(date: Date, format: Prefs['clock']) {
  const h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, '0')
  return format === '12' ? `${((h + 11) % 12) + 1}:${m}` : `${String(h).padStart(2, '0')}:${m}`
}
