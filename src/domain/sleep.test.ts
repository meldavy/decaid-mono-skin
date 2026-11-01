import { describe, expect, it } from 'vitest'
import { clockLayout } from './clockMatrix'
import { nextWake } from './schedule'

describe('sleep clock', () => {
  it('centres the time in the field, each digit dot as scale × scale field dots', () => {
    const l = clockLayout('07:42', 60, 40)
    // 4 digits × 5 wide + colon 1 wide, doubled, plus 4 gaps of 2 = 50 columns
    const cols = [...l.lit].map((k) => Number(k.split(',')[1]))
    expect(Math.min(...cols)).toBe(5)
    expect(Math.max(...cols)).toBe(54)
    expect(l.top).toBe(13)
    expect(l.bottom).toBe(26)
  })
})

describe('SLEEP-02 next wake', () => {
  const mon0700 = new Date(2026, 10, 2, 7, 0) // Monday 2 Nov 2026, 07:00
  it('finds the next enabled schedule time, honouring days of the week', () => {
    const s = [
      { id: 'a', time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true },
      { id: 'b', time: '09:00', daysOfWeek: [6, 7], enabled: true },
      { id: 'c', time: '07:30', daysOfWeek: [], enabled: false },
    ]
    expect(nextWake(s, mon0700)).toEqual(new Date(2026, 10, 3, 6, 30)) // Tuesday 06:30
    expect(nextWake([{ id: 'd', time: '07:30', daysOfWeek: [], enabled: true }], mon0700)).toEqual(new Date(2026, 10, 2, 7, 30))
  })

  it('returns null when nothing is scheduled', () => {
    expect(nextWake([], mon0700)).toBeNull()
    expect(nextWake([{ id: 'x', time: 'bad', daysOfWeek: [], enabled: true }], mon0700)).toBeNull()
  })
})
