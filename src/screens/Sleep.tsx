import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { api } from '../api/client'
import { clockLayout } from '../domain/clockMatrix'
import { nextWake, type WakeSchedule } from '../domain/schedule'
import { requestState } from '../state/machine'
import { prefsResource, withDefaults } from '../state/prefs'
import { createResource, useNow, useResource } from '../state/resource'
import { clock } from '../ui/format'
import { errorToast } from '../ui/toasts'
import { useSize } from '../ui/useSize'
import './sleep.css'

// S4b. Shown only while the machine reports `sleeping`. The screen goes dark after a while; a tap brings the
// clock back without waking the machine; holding anywhere wakes it.

const FIELD_PITCH = 18 // two 9 px grid cells: the field's dots sit on the grid
const HOLD_MS = 800
const HOLD_DOTS = 12

interface DisplayState { brightness: number; requestedBrightness: number; platformSupported: { brightness: boolean } }
interface LatestShot { timestamp: string; workflow?: { profile?: { title?: string } } }

const schedules = createResource(() => api.get<WakeSchedule[]>('/api/v1/presence/schedules'), 60_000)
const latestShot = createResource(() => api.get<LatestShot | null>('/api/v1/shots/latest'), 60_000)

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function Sleep() {
  const prefs = withDefaults(useResource(prefsResource).value)
  const now = useNow(1_000)
  const wakeAt = nextWake(useResource(schedules).value ?? [], new Date(now))
  const last = useResource(latestShot).value
  const [box, size] = useSize<HTMLDivElement>()
  const [dark, setDark] = useState(false)
  const [hold, setHold] = useState(0) // 0–1 while holding
  const [waking, setWaking] = useState(false)
  const darkTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const holdStart = useRef<number | null>(null)
  const holdFrame = useRef<number>(0)
  const brightnessBefore = useRef<number | null>(null)

  // Dark after `screenOffAfter` seconds (0 = never). Brightness goes to 0 where the platform supports it.
  const armDark = () => {
    clearTimeout(darkTimer.current)
    if (prefs.screenOffAfter > 0) darkTimer.current = setTimeout(() => setDark(true), prefs.screenOffAfter * 1000)
  }
  useEffect(() => { armDark(); return () => clearTimeout(darkTimer.current) }, [prefs.screenOffAfter])

  useEffect(() => {
    let cancelled = false
    const apply = async () => {
      try {
        const display = await api.get<DisplayState>('/api/v1/display')
        if (cancelled || !display.platformSupported?.brightness) return
        if (dark) {
          brightnessBefore.current ??= display.requestedBrightness
          await api.put('/api/v1/display/brightness', { brightness: 0 })
        } else if (brightnessBefore.current !== null) {
          await api.put('/api/v1/display/brightness', { brightness: brightnessBefore.current })
          brightnessBefore.current = null
        }
      } catch {
        // Brightness is a nicety; the screen still goes dark visually.
      }
    }
    void apply()
    return () => { cancelled = true }
  }, [dark])
  // Leaving the sleep screen (machine woke) always restores brightness.
  useEffect(() => () => {
    if (brightnessBefore.current !== null) void api.put('/api/v1/display/brightness', { brightness: brightnessBefore.current }).catch(() => undefined)
  }, [])

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    holdStart.current = performance.now()
    const tick = () => {
      if (holdStart.current === null) return
      const p = Math.min(1, (performance.now() - holdStart.current) / HOLD_MS)
      setHold(p)
      if (p >= 1) { holdStart.current = null; void wake(); return }
      holdFrame.current = requestAnimationFrame(tick)
    }
    holdFrame.current = requestAnimationFrame(tick)
  }
  const onUp = () => {
    if (holdStart.current === null) return // the hold already completed
    holdStart.current = null
    cancelAnimationFrame(holdFrame.current)
    setHold(0)
    setDark(false) // a tap only brings the clock back
    armDark()
  }
  const wake = async () => {
    setWaking(true)
    try {
      await requestState('idle')
    } catch (error) {
      errorToast(error)
      setWaking(false)
      setHold(0)
    }
  }

  const date = new Date(now)
  const time = clock(date, prefs.clock)
  const cols = Math.max(1, Math.floor(size.width / FIELD_PITCH))
  const rows = Math.max(1, Math.floor(size.height / FIELD_PITCH))
  const layout = useMemo(() => clockLayout(time, cols, rows), [time, cols, rows])
  const dots = useMemo(() => {
    const on: { x: number; y: number }[] = []
    const off: { x: number; y: number }[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = { x: 9 + c * FIELD_PITCH, y: 9 + r * FIELD_PITCH }
      ;(layout.lit.has(`${r},${c}`) ? on : off).push(d)
    }
    return { on, off }
  }, [layout, cols, rows])
  const clockTop = 9 + layout.top * FIELD_PITCH
  const clockBottom = 9 + layout.bottom * FIELD_PITCH
  const lastTitle = last?.workflow?.profile?.title

  return (
    <div
      ref={box}
      className={`sleep${dark ? ' dark' : ''}`}
      data-testid="sleep"
      data-dark={dark}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="button"
      aria-label="Sleeping. Tap to show the clock, hold to wake the machine"
    >
      {size.width > 0 && (
        <svg width={size.width} height={size.height} className="sleep-field" role="img" aria-label={time} data-testid="sleep-clock">
          {dots.off.map((d, i) => <circle key={`o${i}`} cx={d.x} cy={d.y} r={2} fill="var(--display-cream)" fillOpacity={0.09} />)}
          {dots.on.map((d, i) => <circle key={`l${i}`} cx={d.x} cy={d.y} r={6.5} fill="var(--display-cream)" />)}
        </svg>
      )}
      <div className="sleep-label dots" style={{ top: clockTop - 70 }}>{waking ? 'WAKING' : 'SLEEPING'}</div>
      <div className="sleep-date label" style={{ top: clockBottom + 48 }}>{DAYS[date.getDay()]} · {date.getDate()} {MONTHS[date.getMonth()]}</div>
      <div className="sleep-foot label">
        <span className="sleep-last">
          {last ? <>LAST SHOT · {clock(new Date(last.timestamp), prefs.clock)}<span className="sleep-last-title one-line">{lastTitle || 'Untitled'}</span></> : null}
        </span>
        <span className="sleep-wake">
          {wakeAt ? <span data-testid="wakes-at">WAKES AT {clock(wakeAt, prefs.clock)}</span> : <span />}
          <span className="sleep-hold" aria-hidden>
            {hold > 0
              ? <svg width={HOLD_DOTS * 9} height={9} data-testid="hold-progress">{Array.from({ length: HOLD_DOTS }, (_, i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.6} fill="var(--display-cream)" opacity={i < Math.round(hold * HOLD_DOTS) ? 1 : 0.2} />)}</svg>
              : 'HOLD ANYWHERE TO WAKE'}
          </span>
        </span>
      </div>
    </div>
  )
}
