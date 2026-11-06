import { useEffect, useMemo, useRef, useState } from 'react'
import { planStages, type PlannedStage } from '../domain/profile'
import { stageProgress } from '../domain/stageProgress'
import { replan } from '../domain/timeline'
import { ratio } from '../sheets/values'
import { favourites } from '../state/favourites'
import { dismissShot, SCALE_STALE_MS, scaleConnected, useLive } from '../state/live'
import { requestState } from '../state/machine'
import { DEFAULT_TARGET_TIME, prefsResource, targetTimes, withDefaults } from '../state/prefs'
import { activeProfileId, profiles } from '../state/profiles'
import { useNow, useResource } from '../state/resource'
import { elapsed, type ShotRecord } from '../state/shot'
import { enjoymentToStars, getShot, stopReasonLabel } from '../state/shots'
import { workflow } from '../state/workflow'
import { DotChart, TIME_AXIS_HEIGHT } from '../ui/DotChart'
import { DotIcon } from '../ui/DotIcon'
import { clock, fixed, NONE, tempLabel, toUnit } from '../ui/format'
import { fitDots, fitGrid } from '../ui/fit'
import { errorToast, toast } from '../ui/toasts'
import { snapDown } from '../ui/grid'
import { useSize } from '../ui/useSize'
import { NotesSheet } from './NotesSheet'
import { dye2Loaded, saveShotAsRecipe } from '../state/recipes'
import { plugins } from '../state/settings'
import type { StoredShot } from '../domain/history'
import { TextSheet } from '../ui/Sheets'
import './live.css'

// The dot-matrix type scale (mirrors --dots-* in tokens.css): Doto's dots are 1/10 of the size apart, so these
// match the display's 9 px grid (90) or an even fraction of it. Fitted numbers step down it, never in between.
export const DOTS_SCALE = { xs: 18, s: 30, m: 45, xl: 90 } as const
export const heroStep = (fit: number) => [DOTS_SCALE.xl, DOTS_SCALE.m, DOTS_SCALE.s].find((v) => v <= fit) ?? DOTS_SCALE.s
// The chart shows the first 40 s; a longer shot widens it 10 s at a time. The plan beyond the window waits off the edge.
const CHART_WINDOW = 40
const CHART_WINDOW_STEP = 10
// Tenths until 100 s; whole seconds after, so the number keeps to four characters and fits its column.
export const shotClock = (t: number) => (t >= 100 ? String(Math.floor(t)) : t.toFixed(1))
const DONE_FALLBACK_MS = 6_000 // if Decaid never reports "finished", show the result anyway

const STATUS: Record<string, string> = {
  preparing: 'PREPARING',
  preinfusion: 'PREINFUSION',
  pouring: 'EXTRACTING',
  stopping: 'STOPPING',
  finished: 'DONE',
  nolink: 'NO LINK',
}

// Stage names wrap to two lines before "…"; a long current name drops to one smaller size.
// Names wrap between words; a name with a word too long for the column drops to one smaller size
// (a word is only split when even that can't fit).
const longestWord = (name: string) => Math.max(0, ...name.split(/\s+/).map((w) => w.length))
export const stageSize = (name: string, current: boolean) =>
  current ? (name.length > 12 || longestWord(name) > 9 ? 40 : 56) : longestWord(name) > 9 ? 19 : 22
// The other stages share one size: if any of them needs the smaller size, the whole row uses it.
export const rowSize = (names: string[]) => Math.min(22, ...names.map((n) => stageSize(n, false)))
// The current stage gets up to 300 px (28% of the row); every other stage keeps 136 px, room for a name.
// Stages that don't fit run off the row: it follows the shot, and can be scrolled once the shot is done.
export const currentMinWidth = (rowWidth: number) => Math.min(300, Math.floor(rowWidth * 0.28))
export const STAGE_MIN_WIDTH = 136

// Seconds actually spent in each stage, from the recorded samples.
export function stageDurations(shot: Pick<ShotRecord, 'samples'>, count: number): (number | null)[] {
  return Array.from({ length: count }, (_, i) => {
    const inStage = shot.samples.filter((s) => s.frame === i)
    if (!inStage.length) return null
    const next = shot.samples.find((s) => s.frame > i)
    return (next ? next.t : inStage[inStage.length - 1].t) - inStage[0].t
  })
}

// The live shot and, once Decaid reports it finished, the result. Same layout, two modes.
export function ShotScreen() {
  const live = useLive((l) => l)
  const shot = live.shot!
  const now = useNow(100)
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const records = useResource(profiles).value ?? []
  const slots = useResource(favourites).value ?? []
  const targets = useResource(targetTimes).value ?? {}
  const [stopping, setStopping] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const stopLock = useRef(false)
  // The chart and yield row fill whatever space the screen gives them, on the display's 9 px grid.
  const [displayBox, displaySize] = useSize<HTMLElement>()
  const [chartBox, chartSize] = useSize<HTMLDivElement>()
  const [yieldBox, yieldSize] = useSize<HTMLDivElement>()
  // Pinned to the grid from the top-left: the top block's height is a whole number of grid rows, so the
  // yield row below it lands on the grid too. Spare height collects at the bottom (no dots there).
  const pad = displaySize.height < 380 ? 18 : 27
  const YIELD_BLOCK = 18 + 9 + 9 + 18 // gap above, dot row, gap, labels
  const topHeight = displaySize.height ? snapDown(displaySize.height - 2 * pad - YIELD_BLOCK) : 0
  // Every row the space allows (the pressure labels sit on their nearest row); seconds go under the chart.
  const grid = fitGrid(chartSize.width, topHeight - TIME_AXIS_HEIGHT, 9, { axis: true, anyRows: true })
  const YIELD_DOTS = fitDots(yieldSize.width, 9)
  // Time and weight share one size: the largest step of the dot scale that fits their column
  // (status line + two labels take ~78 px).
  const [numbersBox, numbersSize] = useSize<HTMLDivElement>()
  const bigSize = numbersSize.height ? heroStep((numbersSize.height - 78) / 2 / 0.85) : DOTS_SCALE.xl

  const m = live.machine
  const running = m?.state.state === 'espresso'
  const done = shot.phase === 'finished' || (!!shot.endedAt && now - shot.endedAt > DONE_FALLBACK_MS)

  // The profile is frozen at the start of the shot so the result keeps its stages.
  const frozen = useRef(wf?.profile)
  if (!frozen.current && wf) frozen.current = wf.profile
  const profile = frozen.current
  const stages: PlannedStage[] = useMemo(() => (profile ? planStages(profile) : []), [profile])
  const frame = Math.min(shot.frame, Math.max(0, stages.length - 1))
  const t = elapsed(shot, now)
  const recordedWeight = [...shot.samples].reverse().find((s) => s.weight !== undefined)?.weight
  // A disconnected scale's last reading isn't current: show nothing rather than a stale number.
  const liveWeight = scaleConnected(live.devices) && now - live.scaleAt < SCALE_STALE_MS ? live.scale?.weight : undefined
  const weight = done ? recordedWeight ?? liveWeight : liveWeight
  const targetYield = wf?.context?.targetYield ?? 0
  const dose = wf?.context?.targetDoseWeight ?? 0
  const activeId = activeProfileId(profile, records, slots)
  const targetTime = (activeId && targets[activeId]) || DEFAULT_TARGET_TIME
  const units = prefs.units
  const substate = m?.state.substate ?? ''
  const status = done ? 'finished' : live.link !== 'open' ? 'nolink' : shot.phase === 'pouring' && substate === 'preinfusion' ? 'preinfusion' : running || shot.phase !== 'pouring' ? shot.phase : 'stopping'
  const lit = targetYield > 0 && weight !== undefined ? Math.round(Math.min(1, Math.max(0, weight / targetYield)) * YIELD_DOTS) : 0
  const frameStart = shot.samples.find((x) => x.frame >= frame)?.t ?? 0
  const inStage = Math.max(0, t - frameStart)
  const currentStep = profile?.steps[frame]
  const progress = currentStep ? stageProgress(currentStep, shot.samples.filter((x) => x.frame === frame), inStage) : null
  const [stageRow, stageRowSize, stageRowEl] = useSize<HTMLOListElement>()
  const rowWidth = stageRowSize.width || 1114
  const minWidth = STAGE_MIN_WIDTH
  const currentMin = currentMinWidth(rowWidth)
  const otherSize = rowSize(stages.map((x) => x.name))
  const durations = stageDurations(shot, stages.length)
  const chartPlan = useMemo(() => replan(stages, shot.samples), [stages, shot.samples])
  // Bring the current stage to the middle of the row (the browser stops at either end): while pouring
  // it follows the shot; when done it shows where the shot ended, once, then the row is the person's to scroll.
  useEffect(() => {
    const li = stageRowEl?.children[frame] as HTMLElement | undefined
    if (!stageRowEl || !li) return
    stageRowEl.scrollTo({ left: li.offsetLeft - (stageRowEl.clientWidth - li.offsetWidth) / 2, behavior: done ? 'auto' : 'smooth' })
  }, [stageRowEl, frame, done, stages.length, rowWidth])
  const peak = shot.samples.reduce((mx, s) => Math.max(mx, s.pressure), 0)
  const avgFlow = shot.samples.length ? shot.samples.reduce((sum, s) => sum + s.flow, 0) / shot.samples.length : 0

  const stop = async () => {
    if (stopLock.current) return
    stopLock.current = true
    setStopping(true)
    try {
      await requestState('idle')
    } catch (error) {
      errorToast(error)
      setStopping(false)
    } finally {
      stopLock.current = false
    }
  }
  const skip = async () => {
    if (skipping) return
    setSkipping(true)
    try {
      await requestState('skipStep')
    } catch (error) {
      errorToast(error)
    } finally {
      setSkipping(false)
    }
  }

  const title = profile?.title ?? ''
  const endedAt = shot.endedAt ? clock(new Date(shot.endedAt), prefs.clock) : ''
  return (
    <div className="live" data-testid={done ? 'shot-done' : 'live-shot'} data-shot-id={shot.id ?? ''}>
      <header className="live-header">
        <div className="live-title-row">
          <span className="live-title one-line">
            {title || 'Untitled'}
          </span>
          <span className="label" data-testid="stage-count">
            {done ? [stopReasonLabel(shot.stop?.reason), endedAt].filter(Boolean).join(' · ') : `STAGE ${stages.length ? frame + 1 : 0} OF ${stages.length}`}
          </span>
        </div>
        <ol className={`stages${done ? ' scrollable' : ''}`} aria-label="Stages" data-testid="stages" ref={stageRow}>
          {stages.map((s, i) => {
            const planned = s.t1 - s.t0
            const reached = durations[i] !== null
            const state = done ? (reached ? 'done reached' : 'next') : i < frame ? 'done' : i === frame ? 'current' : 'next'
            const pct = state === 'current' ? (progress?.progress ?? 0) * 100 : 0
            const grow = state === 'current' ? Math.max(planned, 18) : done && reached ? Math.max(1, durations[i]!) : planned
            return (
              <li key={i} className={`stage ${state}`} style={{ flexGrow: grow, minWidth: state === 'current' ? currentMin : minWidth }} aria-current={state === 'current' ? 'step' : undefined} data-testid={`stage-${i}`}>
                <span className="stage-rail" aria-hidden>
                  <span className="stage-dot" />
                  {/* Dots sit at fixed places along the line; progress only lights them, like the yield bar. */}
                  <span className="stage-line">{state === 'current' && <span className="stage-line-lit" style={{ width: `${pct}%` }} />}</span>
                </span>
                <span className={`stage-name${state === 'current' ? '' : ' two-line'}`} style={{ fontSize: state === 'current' ? stageSize(s.name, true) : otherSize }} title={s.name}>{s.name || `Stage ${i + 1}`}</span>
                <span className="label stage-meta one-line">
                  {state === 'current'
                    ? <><span style={{ color: 'var(--ink)' }} data-testid="stage-progress" data-kind={progress?.kind}>{progress?.label ?? `${inStage.toFixed(1)} S`}</span> · {stageTarget(s)}</>
                    : done ? (reached ? `${durations[i]!.toFixed(1)} S` : 'NOT REACHED') : `${fixed(planned, 0)} S`}
                </span>
              </li>
            )
          })}
        </ol>
      </header>

      <section className="live-display display" ref={displayBox} style={{ padding: pad }} aria-label={done ? 'Shot result' : 'Live machine display'}>
        <div className="live-top" style={{ height: topHeight || undefined }}>
          <div className="live-numbers" ref={numbersBox} style={{ ['--big' as string]: `${bigSize}px` }}>
            <span className="dots live-status" data-testid="live-status"><span className="pip" style={done ? { background: 'var(--display-cream)' } : undefined} />{STATUS[status] ?? status.toUpperCase()}</span>
            <div className="live-number">
              <span className="label" data-testid="time-label">TIME S · GOAL {targetTime}{done ? ` · ${goalDelta(t, targetTime)}` : ''}</span>
              <span className="dots big" data-testid="live-time">{shotClock(t)}</span>
            </div>
            <div className="live-number">
              <span className="label">WEIGHT G</span>
              <span className="dots big" data-testid="live-weight">{weight === undefined ? NONE : fixed(Math.max(0, weight), 1)}</span>
            </div>
          </div>
          <div className="chart-fit" ref={chartBox}>
            {chartSize.width > 0 && (
              <DotChart stages={chartPlan} samples={shot.samples} window={CHART_WINDOW} windowStep={CHART_WINDOW_STEP} timeAxis looseAxis live={!done && running} theme="dark" cols={grid.cols} rows={grid.rows} axis label={done ? 'The finished shot over its plan' : 'Live shot over the profile plan'} />
            )}
          </div>
        </div>
        <div className="live-yield" ref={yieldBox}>
          <svg className="grid-patch yield-dots" width={YIELD_DOTS * 9} height={9} viewBox={`0 0 ${YIELD_DOTS * 9} 9`} aria-hidden data-lit={lit}>
            {Array.from({ length: YIELD_DOTS }, (_, i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.6} fill="var(--display-cream)" opacity={i < lit ? 1 : 0.18} />)}
          </svg>
          <div className="label yield-labels">
            <span>0</span>
            <span data-testid="yield-pct">
              {targetYield <= 0 || weight === undefined ? 'NO TARGET'
                : done ? `${fixed(Math.max(0, weight), 1)} OF ${fixed(targetYield, 1)} G`
                : `${Math.round((Math.max(0, weight) / targetYield) * 100)}% OF YIELD`}
            </span>
            <span>{fixed(targetYield, 1)} G</span>
          </div>
        </div>
      </section>

      {done ? (
        <DoneBar shotId={shot.id} peak={peak} avgFlow={avgFlow} ratio={weight === undefined ? NONE : ratio(Math.max(0, weight), dose)} />
      ) : (
        <div className="live-bottom">
          <div className="live-readouts">
            <Readout label="PRESSURE BAR" value={fixed(m?.pressure, 1)} testId="live-pressure" />
            <Readout label="FLOW ML/S" value={fixed(m?.flow, 1)} testId="live-flow" />
            <Readout label={`GROUP ${tempLabel(units)}`} value={m ? fixed(toUnit(m.groupTemperature, units), 1) : NONE} />
          </div>
          <div className="tile-row">
            <button type="button" className="tile" onClick={skip} disabled={!running || skipping || frame >= stages.length - 1}><DotIcon glyph="next" />NEXT</button>
            <button type="button" className="primary" onClick={stop} disabled={!running || stopping}>
              <DotIcon glyph="stop" color="var(--on-primary)" primary />{stopping && running ? 'STOPPING…' : 'STOP'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DoneBar({ shotId, peak, avgFlow, ratio: shotRatio }: { shotId: string | null; peak: number; avgFlow: number; ratio: string }) {
  const [stars, setStars] = useState(0)
  const [notesOpen, setNotesOpen] = useState(false)
  const canRecipe = dye2Loaded(useResource(plugins).value)
  const [naming, setNaming] = useState<StoredShot | null>(null)
  const openRecipe = () => { if (shotId) getShot(shotId).then((s) => setNaming(s as unknown as StoredShot), (e) => errorToast(e)) }
  const saveRecipe = async (shot: StoredShot, name: string) => {
    try { const r = await saveShotAsRecipe(shot, name); toast(`Saved “${r.name}” as a recipe`) } catch (error) { errorToast(error, "Couldn't save the recipe. Is DYE2 up to date?") }
  }
  // Decaid saves the shot a few seconds after it ends, and doesn't save one stopped almost at once.
  const [saved, setSaved] = useState<'checking' | 'yes' | 'no'>('checking')

  useEffect(() => {
    if (!shotId) { setSaved('no'); toast("This shot wasn't saved, so it can't be rated."); return }
    let cancelled = false
    let tries = 0
    const check = () => getShot(shotId).then((s) => {
      if (cancelled) return
      setSaved('yes')
      setStars(enjoymentToStars(s.annotations?.enjoyment))
    }, () => {
      if (cancelled) return
      if (++tries < 6) setTimeout(check, 1_000)
      else { setSaved('no'); toast("This shot wasn't saved, so it can't be rated.") }
    })
    void check()
    return () => { cancelled = true }
  }, [shotId])

  // Rate opens the notes sheet with the rating at the top; the bar keeps only the result and Done.
  return (
    <div className="live-bottom">
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div className="tile-row">
        <button type="button" className="tile" data-testid="rate-tile" aria-label={stars ? `Rate, rated ${stars} of 5` : 'Rate'} disabled={saved !== 'yes'} onClick={() => setNotesOpen(true)}>
          <DotIcon glyph="heart" />RATE
        </button>
        {canRecipe && (
          <button type="button" className="tile two-lines" data-testid="recipe-tile" aria-label="Save as a recipe" disabled={saved !== 'yes'} onClick={openRecipe}>
            <DotIcon glyph="beans" /><span className="tile-two-lines">SAVE AS<br />RECIPE</span>
          </button>
        )}
        </div>
        <div className="live-readouts">
          <Readout label="RATIO" value={shotRatio} testId="ratio" />
          <Readout label="PEAK BAR" value={fixed(peak, 1)} testId="peak" />
          <Readout label="AVG ML/S" value={fixed(avgFlow, 1)} testId="avg-flow" />
        </div>
      </div>
      <button type="button" className="primary" onClick={dismissShot}><DotIcon glyph="check" color="var(--on-primary)" primary />DONE</button>
      {naming && (
        <TextSheet label="RECIPE NAME" value={[naming.workflow?.context?.coffeeName, naming.workflow?.profile?.title].filter((x) => x && x.trim()).join(' · ').slice(0, 60)} multiline={false} maxLength={60}
          onCancel={() => setNaming(null)}
          onDone={(name) => { const s = naming; setNaming(null); if (name) void saveRecipe(s, name) }} />
      )}
      {notesOpen && shotId && <NotesSheet shotId={shotId} rating onClose={(result) => { setNotesOpen(false); if (result) setStars(result.stars) }} />}
    </div>
  )
}

// A value with its label underneath, centred, like the label under a tile's icon.
function Readout({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <span className="readout-stack">
      <span className="dots readout" data-testid={testId}>{value}</span>
      <span className="label">{label}</span>
    </span>
  )
}

function goalDelta(t: number, goal: number) {
  const d = t - goal
  if (Math.abs(d) < 0.5) return 'ON GOAL'
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`
}

function stageTarget(s: PlannedStage) {
  const unit = s.pump === 'pressure' ? 'BAR' : 'ML/S'
  return s.from === s.to ? `${fixed(s.to, 1)} ${unit}` : `${fixed(s.from, 1)} → ${fixed(s.to, 1)} ${unit}`
}
