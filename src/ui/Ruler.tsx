import { useEffect, useRef, type PointerEvent } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step: number
  decimals: number
  onChange: (value: number) => void
  label: string
  compact?: boolean // less space above the dots and below the numbers (the editor's inline rulers); still 44 px to touch
}

const SPAN = 20 // steps either side of the needle
const TICK_STEP = 27 // px between ticks: 3 grid cells
const PX_PER_STEP = 12 // drag sensitivity, independent of tick spacing

// Dot ruler: drag sideways to change the value; it snaps to the step.
export function Ruler({ value, min, max, step, decimals, onChange, label, compact = false }: Props) {
  const drag = useRef<{ x: number; start: number; id: number } | null>(null)
  const clamp = (v: number) => Number(Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(decimals))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, start: value, id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const next = clamp(d.start - ((e.clientX - d.x) / PX_PER_STEP) * step)
    if (next !== value) onChange(next)
  }
  const end = () => { drag.current = null }

  // A value from Decaid can be outside the range: draw the ruler at the nearest end rather than an empty one.
  const centre = clamp(value)
  const ticks = []
  for (let i = -SPAN; i <= SPAN; i++) {
    const v = Number((Math.round((centre - min) / step + i) * step + min).toFixed(decimals))
    const index = Math.round(v / step) // majors on round numbers, not counted from min
    const inRange = v >= min - 1e-9 && v <= max + 1e-9
    const major = index % 10 === 0
    const mid = index % 5 === 0
    ticks.push({ i, v, inRange, major, size: major ? 9 : mid ? 6 : 4, color: !inRange ? 'transparent' : major ? 'var(--taupe)' : mid ? '#CDBBA3' : '#E6DCCC' })
  }
  const majors = ticks.filter((t) => t.major && t.inRange)

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-step={step}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(clamp(value - step))
        if (e.key === 'ArrowRight') onChange(clamp(value + step))
      }}
      style={{ position: 'relative', padding: compact ? '5px 0 0' : '10px 0 0', touchAction: 'none', cursor: 'ew-resize' }}
      data-testid="ruler"
    >
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 18, overflow: 'hidden' }}>
        {ticks.map((t) => (
          <span key={t.i} style={{ width: TICK_STEP, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
            <span style={{ width: t.size, height: t.size, borderRadius: '50%', background: t.color }} />
          </span>
        ))}
      </div>
      <span aria-hidden style={{ position: 'absolute', left: 'calc(50% - 1px)', top: 0, width: 2, height: compact ? 26 : 38, background: 'var(--brown)' }} />
      <div className="label" style={{ position: 'relative', height: 14, marginTop: compact ? 7 : 12, overflow: 'hidden' }}>
        {majors.map((t) => (
          <span key={t.i} style={{ position: 'absolute', left: `calc(50% + ${t.i * TICK_STEP}px)`, transform: 'translateX(-50%)' }}>{t.v}</span>
        ))}
      </div>
    </div>
  )
}

// − / + button that repeats while held, speeding up.
export function useHoldRepeat(action: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(action)
  latest.current = action
  const stop = () => clearTimeout(timer.current)
  useEffect(() => stop, [])
  const start = () => {
    latest.current()
    let delay = 400
    const tick = () => {
      timer.current = setTimeout(() => {
        latest.current()
        delay = Math.max(60, delay * 0.75)
        tick()
      }, delay)
    }
    tick()
  }
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop }
}
