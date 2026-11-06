import { memo, useMemo } from 'react'
import { colFor, join, quantize, rowFor, type Cell, type GridSpec } from '../domain/grid'
import { plannedDuration, plannedSeriesAt, type PlannedStage } from '../domain/profile'
import { lanes, stageAtColumn, timeAtColumn } from '../domain/timeline'

export interface ShotSample {
  t: number // seconds since the shot started
  pressure: number
  flow: number
  frame?: number // the profile stage the machine was in
}

interface Props {
  stages: PlannedStage[]
  samples?: ShotSample[]
  live?: boolean // show the "now" column and ghost the rest of the plan
  mode?: 'trail' | 'field' // trail: large charts on white; field: compact lit matrix
  theme?: 'light' | 'dark'
  cols: number
  rows: number
  pitch?: number
  label: string
  axis?: boolean // pressure values on the left (0–12 bar), in their own grid columns
  looseAxis?: boolean // any row count: every pressure value shows, on its nearest row
  rail?: boolean // a dotted stage rail under the chart, alternating tone per stage
  columns?: number[] // lay the plan out stage by stage: grid columns per stage (see stageColumns); `cols` is then their sum. Plan only: no samples
  window?: number // time axis: show this many seconds (instead of the plan's length), widening once the shot runs longer
  windowStep?: number // widen the window in steps of this many seconds, so drawn dots stay put between steps
  timeAxis?: boolean // seconds under the chart, every TIME_TICK s (two grid rows)
}

export const AXIS_COLS = 3
export const AXIS_VALUES = [0, 3, 6, 9, 12]

// Only values that land exactly on a row are labelled, so the labels are evenly spaced.
// Pick rows with (rows - 1) divisible by 4 (9, 13, 29 …) to get every 3 bar.
export function axisValues(rows: number, loose = false) {
  if (loose) return AXIS_VALUES // each on its nearest row
  return AXIS_VALUES.filter((v) => Number.isInteger((v / 12) * (rows - 1)))
}

export const CHART_MAX = 12 // bar and ml/s share one axis, as on the machine
const TRAIL = [1, 0.18, 0.08, 0.03]
const PLAN_TRACE = 8 // plan points per column
const span = (cell: Cell | null | undefined) => (cell ? Array.from({ length: cell.hi - cell.lo + 1 }, (_, i) => cell.lo + i) : [])

const COLORS = {
  light: { ink: 'var(--ink)', field: 'var(--field)', ghost: 'var(--line)', ghostField: 'var(--line-strong)', now: 'var(--line-mid)' },
  dark: { ink: 'var(--display-cream)', field: 'rgba(237,227,210,0.14)', ghost: 'rgba(237,227,210,0.22)', ghostField: 'rgba(237,227,210,0.42)', now: 'rgba(237,227,210,0.4)' },
}

interface Dot { x: number; y: number; o?: number }

export const DISPLAY_PITCH = 9 // the display's background grid — every chart uses it, on the display or not

const TIME_TICK = 10
const TIME_AXIS_ROWS = 2
export const TIME_AXIS_HEIGHT = TIME_AXIS_ROWS * DISPLAY_PITCH
// Whole multiples of TIME_TICK seconds across the span, from TIME_TICK (no 0: the pressure scale's 0 is beside it).
export const timeTicks = (duration: number) => Array.from({ length: Math.floor(duration / TIME_TICK + 1e-9) }, (_, i) => (i + 1) * TIME_TICK)

// The window, widened by whole steps until the shot fits (or exactly to the shot, without steps). Steps come
// STEP_LEAD s early, so the now line never runs off the edge while it waits for the next step.
const STEP_LEAD = 1
export function timeSpan(window: number, step: number | undefined, last: number) {
  if (!step) return Math.max(window, last)
  const reach = last + STEP_LEAD
  return reach <= window ? window : window + Math.ceil((reach - window) / step) * step
}

// A chart redraws only when its own props change (React.memo), not whenever its screen re-renders.
export const DotChart = memo(function DotChart({ stages, samples = [], live = false, mode = 'trail', theme = 'light', cols, rows, pitch = DISPLAY_PITCH, label, axis = false, rail = false, columns, window, windowStep, timeAxis = false, looseAxis = false }: Props) {
  const dots = useMemo(() => {
    // The x axis is time (seconds), or with `columns` the plan laid out stage by stage (then a "time" is a column).
    const ls = columns ? lanes(stages, columns) : null
    const shot = ls ? [] : samples
    const last = shot.length ? shot[shot.length - 1].t : 0
    const duration = ls ? cols : (window === undefined ? Math.max(plannedDuration(stages), last) : timeSpan(window, windowStep, last)) || 1
    const planAt = (c: number) => plannedSeriesAt(stages, ls ? timeAtColumn(ls, c) : ((c + 0.5) / cols) * duration)
    const spec: GridSpec = { cols, rows, max: CHART_MAX }
    const pressure = quantize(shot.map((s) => ({ t: s.t, v: s.pressure })), duration, spec)
    const flow = quantize(shot.map((s) => ({ t: s.t, v: s.flow })), duration, spec)
    // The plan goes through the same column step as the shot: traced finely (8 points per column), so a short stage
    // or a step isn't skipped between column centres.
    const trace = Array.from({ length: cols * PLAN_TRACE }, (_, k) => {
      const x = (k + 0.5) / PLAN_TRACE // position in columns
      const t = ls ? x : (x / cols) * duration
      return { t, plan: plannedSeriesAt(stages, ls ? timeAtColumn(ls, x - 0.5) : t) }
    })
    const planP = quantize(trace.map(({ t, plan }) => ({ t, v: plan?.pressure ?? Number.NaN })), duration, spec)
    const planF = quantize(trace.map(({ t, plan }) => ({ t, v: plan?.flow ?? Number.NaN })), duration, spec)
    const nowCol = shot.length ? colFor(last, duration, cols) : -1
    const H = rows * pitch
    const gutter = axis ? AXIS_COLS * pitch : 0
    const at = (c: number, r: number, o?: number): Dot => ({ x: gutter + c * pitch + pitch / 2, y: H - pitch / 2 - r * pitch, o })

    const out = { duration, field: [] as Dot[], p: [] as Dot[], f: [] as Dot[], gp: [] as Dot[], gf: [] as Dot[], now: [] as Dot[], rail: [] as (Dot & { tone: number })[] }
    // Each column shows the shot where it has been recorded, otherwise the plan. Without a live shot the
    // plan is drawn solid (it *is* the picture of the profile); with a shot it ghosts beyond the shot.
    let prev = { p: null as Cell | null, f: null as Cell | null, ghost: false }
    for (let c = 0; c < cols; c++) {
      if (mode === 'field') for (let r = 0; r < rows; r++) out.field.push(at(c, r))
      if (rail) {
        const index = ls ? stageAtColumn(ls, c) : planAt(c)?.stage?.index ?? 0
        const reached = !shot.length || c <= nowCol
        out.rail.push({ ...at(c, -1), o: reached ? 1 : 0.45, tone: index % 2 })
      }
      const recorded = shot.length > 0 && c <= nowCol
      let cp: Cell | null
      let cf: Cell | null
      if (recorded) {
        // An empty column carries on from the previous column's last value (not its whole span).
        cp = pressure[c] ?? (prev.p && { lo: prev.p.last, hi: prev.p.last, last: prev.p.last })
        cf = flow[c] ?? (prev.f && { lo: prev.f.last, hi: prev.f.last, last: prev.f.last })
      } else {
        if (live && c === nowCol + 1) for (let r = 0; r < rows; r++) out.now.push(at(c, r))
        cp = planP[c]
        cf = planF[c]
      }
      // Unreached plan is ghosted once there's a shot (live or finished); a profile on its own is solid.
      const ghost = (live || shot.length > 0) && !recorded
      const joins = prev.ghost === ghost
      if (cp) {
        if (ghost) span(cp).forEach((r) => out.gp.push(at(c, r)))
        else if (mode === 'field') {
          if (joins && prev.p) join(prev.p, cp).forEach((r) => out.p.push(at(c, r, 1)))
          span(cp).forEach((r) => out.p.push(at(c, r, 1)))
        } else {
          // Trail: the span at full strength, fading dots below it.
          span(cp).forEach((r) => out.p.push(at(c, r, 1)))
          TRAIL.slice(1).forEach((o, k) => cp!.lo - k - 1 >= 0 && out.p.push(at(c, cp!.lo - k - 1, o)))
        }
      }
      if (cf) {
        if (ghost) span(cf).forEach((r) => out.gf.push(at(c, r)))
        else {
          if (joins && prev.f) join(prev.f, cf).forEach((r) => out.f.push(at(c, r)))
          span(cf).forEach((r) => out.f.push(at(c, r)))
        }
      }
      prev = { p: cp, f: cf, ghost }
    }
    return out
  }, [stages, samples, live, mode, cols, rows, pitch, axis, rail, columns, window, windowStep])

  const c = COLORS[theme]
  const gutter = axis ? AXIS_COLS * pitch : 0
  const w = gutter + cols * pitch
  const H = rows * pitch
  const h = H + (rail ? pitch : 0) + (timeAxis ? TIME_AXIS_ROWS * pitch : 0) // a grid row below for the stage rail; two for the time axis
  const r = pitch * 0.26
  const labelColor = theme === 'dark' ? 'var(--display-label)' : 'var(--taupe)'
  // Where flow lands on a (visible) pressure dot, the flow dot keeps a ring of the pressure colour, so both show.
  const pressureAt = new Set(dots.p.filter((d) => (d.o ?? 1) >= 0.5).map((d) => `${d.x},${d.y}`))
  const railTones = theme === 'dark' ? ['var(--display-label)', 'rgba(237,227,210,0.28)'] : ['var(--taupe)', 'var(--line-mid)']
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className={theme === 'dark' ? 'grid-patch' : undefined} style={{ display: 'block', flexShrink: 0 }} data-testid="dot-chart" data-pitch={pitch}>
      {dots.field.map((d, i) => <circle key={`fd${i}`} cx={d.x} cy={d.y} r={r} fill={c.field} />)}
      {dots.now.map((d, i) => <circle key={`n${i}`} cx={d.x} cy={d.y} r={r} fill={c.now} />)}
      <g data-series="plan">
        {dots.gp.map((d, i) => <circle key={`gp${i}`} cx={d.x} cy={d.y} r={r} fill={mode === 'field' ? c.ghostField : c.ghost} />)}
        {dots.gf.map((d, i) => <circle key={`gf${i}`} cx={d.x} cy={d.y} r={r} fill="var(--accent)" opacity={0.35} />)}
      </g>
      <g data-series="pressure">
        {dots.p.map((d, i) => <circle key={`p${i}`} cx={d.x} cy={d.y} r={r} fill={c.ink} opacity={d.o} />)}
      </g>
      <g data-series="flow">
        {dots.f.map((d, i) => pressureAt.has(`${d.x},${d.y}`)
          ? <circle key={`f${i}`} cx={d.x} cy={d.y} r={r - 0.5} fill="var(--accent)" stroke={c.ink} strokeWidth={1} data-overlap="" />
          : <circle key={`f${i}`} cx={d.x} cy={d.y} r={r} fill="var(--accent)" />)}
      </g>
      {axis && (
        <g data-series="axis" fontFamily="var(--mono)" fontSize={10} letterSpacing="0.06em" fill={labelColor} textAnchor="end">
          {axisValues(rows, looseAxis).map((v) => (
            <text key={v} x={gutter - 6} y={H - pitch / 2 - rowFor(v, { rows, max: CHART_MAX }) * pitch + 3.5}>{v}</text>
          ))}
        </g>
      )}
      {timeAxis && (
        <g data-series="time-axis" fontFamily="var(--mono)" fontSize={10} letterSpacing="0.06em" fill={labelColor}>
          {timeTicks(dots.duration).map((t) => {
            const x = gutter + (t / dots.duration) * cols * pitch
            // The last number sits inside the chart's edge; the rest centre on their second.
            const anchor = x > w - 12 ? 'end' : 'middle'
            return <text key={t} x={Math.min(x, w)} y={H + (rail ? pitch : 0) + 13} textAnchor={anchor}>{t}</text>
          })}
        </g>
      )}
      {rail && (
        <g data-series="rail">
          {dots.rail.map((d, i) => <circle key={`r${i}`} cx={d.x} cy={d.y} r={r * 0.9} fill={railTones[d.tone]} opacity={d.o} />)}
        </g>
      )}
    </svg>
  )
})

// The pressure scale on its own, for a chart that scrolls sideways under a fixed scale.
export function ChartAxis({ rows, pitch = DISPLAY_PITCH, theme = 'light' }: { rows: number; pitch?: number; theme?: 'light' | 'dark' }) {
  const w = AXIS_COLS * pitch
  const H = rows * pitch
  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden style={{ display: 'block', flexShrink: 0 }} data-testid="chart-axis">
      <g fontFamily="var(--mono)" fontSize={10} letterSpacing="0.06em" fill={theme === 'dark' ? 'var(--display-label)' : 'var(--taupe)'} textAnchor="end">
        {axisValues(rows).map((v) => <text key={v} x={w - 6} y={H - pitch / 2 - rowFor(v, { rows, max: CHART_MAX }) * pitch + 3.5}>{v}</text>)}
      </g>
    </svg>
  )
}
