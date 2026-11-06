import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

// Hold-to-confirm for destructive actions: a dot row fills while held; letting go early resets it;
// it fires once when full. Keyboard: holding Enter or Space works the same way.

export const HOLD_MS = 1_200
const DOTS = 14

interface Props {
  label: string // e.g. "HOLD TO DELETE"
  onConfirm: () => void
  className?: string
  children?: ReactNode
}

export function HoldButton({ label, onConfirm, className = 'primary hold' }: Props) {
  const [progress, setProgress] = useState(0)
  const start = useRef<number | null>(null)
  const frame = useRef(0)
  const fired = useRef(false)

  const begin = () => {
    if (fired.current || start.current !== null) return
    start.current = performance.now()
    const tick = () => {
      if (start.current === null) return
      const p = Math.min(1, (performance.now() - start.current) / HOLD_MS)
      setProgress(p)
      if (p >= 1) { start.current = null; fired.current = true; onConfirm(); return }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }
  const end = () => {
    if (start.current === null) return
    start.current = null
    cancelAnimationFrame(frame.current)
    setProgress(0)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const lit = Math.round(progress * DOTS)
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      data-progress={lit}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture?.(e.pointerId); begin() }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); begin() } }}
      onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') end() }}
    >
      <span>{label}</span>
      <svg width={DOTS * 9} height={9} viewBox={`0 0 ${DOTS * 9} 9`} aria-hidden>
        {Array.from({ length: DOTS }, (_, i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.2} fill="var(--on-primary)" opacity={i < lit ? 1 : 0.3} />)}
      </svg>
    </button>
  )
}
