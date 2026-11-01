// Heating countdown from Decaid's optional time-to-ready plugin (~1 frame per second). Mono only listens;
// if the plugin is off, the stream never opens and Home just says HEATING.

export interface TtrFrame { status?: string; remainingTimeMs?: number }
export interface TtrEstimate { deadline: number; at: number }

export const TTR_STALE_MS = 6_000 // a stream that's gone quiet this long is not trusted
export const TTR_CAP_S = 300 // estimates above 5 minutes are shown as 5 minutes

// A frame with a usable number sets the deadline; any frame refreshes the "heard from" time.
export function foldTtr(frame: TtrFrame, now: number, previous: TtrEstimate | null): TtrEstimate | null {
  if (frame.status === 'heating' && typeof frame.remainingTimeMs === 'number' && frame.remainingTimeMs > 0) {
    return { deadline: now + frame.remainingTimeMs, at: now }
  }
  return previous ? { ...previous, at: now } : null
}

// Whole seconds to show, or 0 for "no number" (no estimate, stale, or well past the deadline).
export function ttrSeconds(estimate: TtrEstimate | null, now: number): number {
  if (!estimate || now - estimate.at > TTR_STALE_MS) return 0
  const left = Math.ceil((estimate.deadline - now) / 1000)
  if (left < -10) return 0
  return Math.min(TTR_CAP_S, Math.max(1, left))
}
