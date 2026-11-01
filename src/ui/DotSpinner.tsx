import { useEffect, useState } from 'react'

// A waiting indicator in the display's dot language: a 3 × 3 grid whose lit dot runs around the ring, with a fading tail.
const RING = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]] as const
const TAIL = [1, 0.55, 0.3]

export function DotSpinner({ color = 'currentColor', pitch = 6 }: { color?: string; pitch?: number }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    let still = false
    try { still = matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* no media queries */ }
    if (still) return
    const timer = setInterval(() => setStep((s) => (s + 1) % RING.length), 125)
    return () => clearInterval(timer)
  }, [])
  const size = pitch * 3
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ display: 'block', flexShrink: 0 }} data-testid="dot-spinner">
      {RING.map(([c, r], i) => {
        const behind = (step - i + RING.length) % RING.length
        return <circle key={i} cx={c * pitch + pitch / 2} cy={r * pitch + pitch / 2} r={pitch * 0.28} fill={color} opacity={TAIL[behind] ?? 0.15} />
      })}
    </svg>
  )
}
