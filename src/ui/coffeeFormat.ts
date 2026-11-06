import { MONTHS } from '../domain/history'
import { roastAge, type Bag } from '../state/coffee'

// "ROASTED 25 OCT", with the year once it isn't this year.
export function roastedLabel(roastDate: string | null | undefined, now: Date) {
  if (!roastDate) return undefined
  const d = new Date(roastDate)
  if (Number.isNaN(d.getTime())) return undefined
  return `ROASTED ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`
}

// One bag on a chip: its roast date and age, then what's left of it. "ROASTED 25 OCT · 12 D · 250 G".
export function bagLabel(bag: Bag, now: Date) {
  const age = roastAge(bag.roastDate, now)
  const grams = bag.weightRemaining ?? bag.weight
  return [roastedLabel(bag.roastDate, now) ?? 'NO ROAST DATE', age !== undefined ? `${age} D` : '', grams != null ? `${Math.round(grams)} G` : '']
    .filter(Boolean).join(' · ')
}
