// Decaid wake schedules (GET /api/v1/presence/schedules).
export interface WakeSchedule {
  id: string
  time: string // "HH:MM"
  daysOfWeek: number[] // 1 = Monday … 7 = Sunday (Dart weekday); empty = every day
  enabled: boolean
  keepAwakeFor?: number | null
}

const isoWeekday = (d: Date) => ((d.getDay() + 6) % 7) + 1

// The next time any enabled schedule wakes the machine, within a week; null if none.
export function nextWake(schedules: WakeSchedule[], now: Date): Date | null {
  let best: Date | null = null
  for (const s of schedules) {
    if (!s.enabled) continue
    const [h, m] = s.time.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue
    for (let add = 0; add <= 7; add++) {
      const d = new Date(now)
      d.setDate(now.getDate() + add)
      d.setHours(h, m, 0, 0)
      if (d <= now) continue
      if (s.daysOfWeek.length && !s.daysOfWeek.includes(isoWeekday(d))) continue
      if (!best || d < best) best = d
      break
    }
  }
  return best
}
