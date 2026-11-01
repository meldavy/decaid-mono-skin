import { useEffect, useRef } from 'react'

// Settings → Look & sound → "Play a sound when a shot finishes". Two soft sine notes, generated (no audio files).
let ctx: AudioContext | null = null

export function playChime() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const now = ctx.currentTime
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + i * 0.18
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.65)
    }
    ;(window as unknown as { __monoChimes?: number }).__monoChimes = ((window as unknown as { __monoChimes?: number }).__monoChimes ?? 0) + 1
  } catch {
    // No audio on this device: stay silent.
  }
}

// Plays once per shot, when it reaches finished.
export function useCompletionChime(shotKey: string | null, finished: boolean, enabled: boolean) {
  const played = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !finished || !shotKey || played.current === shotKey) return
    played.current = shotKey
    playChime()
  }, [shotKey, finished, enabled])
}
