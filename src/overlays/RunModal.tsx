import { useEffect, useRef, useState } from 'react'
import { SCALE_STALE_MS, scaleConnected, useLive } from '../state/live'
import { requestState } from '../state/machine'
import { prefsResource, withDefaults } from '../state/prefs'
import { useNow, useResource } from '../state/resource'
import { workflow } from '../state/workflow'
import { DotIcon } from '../ui/DotIcon'
import { fixed, NONE, tempLabel, toUnit } from '../ui/format'
import './run.css'

export type RunKind = 'steam' | 'hotWater' | 'flush'

interface Reading { label: string; value: string; unit: string; target: string }

const COLS = 72

// Shown while the machine steams, pours hot water or flushes — whoever started it.
// It can't be dismissed: it ends with Stop or when the machine goes back to idle.
export function RunModal({ kind }: { kind: RunKind }) {
  const live = useLive((l) => l)
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const now = useNow(200) // 5 fps: the progress bar moves smoothly
  const startedAt = useRef(Date.now())
  const volume = useRef({ ml: 0, at: Date.now() })
  const [stop, setStop] = useState<'idle' | 'pending' | 'queued' | 'failed'>('idle')
  const linkOpen = live.link === 'open'
  const hasScale = scaleConnected(live.devices)
  const m = live.machine

  // Hot water volume without a scale: integrate the machine's flow.
  useEffect(() => {
    if (!m) return
    const t = Date.now()
    volume.current = { ml: volume.current.ml + m.flow * ((t - volume.current.at) / 1000), at: t }
  }, [m])

  const sendStop = async () => {
    setStop('pending')
    try {
      await requestState('idle')
    } catch {
      setStop('failed')
    }
  }
  // A Stop pressed while the link was down goes out as soon as it's back.
  useEffect(() => {
    if (linkOpen && stop === 'queued') void sendStop()
  }, [linkOpen, stop])

  const onStop = () => {
    if (stop === 'pending') return
    if (!linkOpen) return setStop('queued')
    void sendStop()
  }

  const exact = Math.max(0, (now - startedAt.current) / 1000) // drives the bar
  const elapsed = Math.floor(exact) // what the numbers show
  const units = prefs.units
  const t = (c: number | undefined) => (c === undefined ? NONE : fixed(toUnit(c, units), 0))
  const tl = tempLabel(units)

  let title = ''
  let eyebrow = ''
  let glyph: 'steam' | 'water' | 'flush' = 'steam'
  let readings: Reading[] = []
  let progress = 0
  let caption = ''

  if (kind === 'steam') {
    const s = wf?.steamSettings
    title = 'STEAMING'; eyebrow = 'STEAM WAND'; glyph = 'steam'
    readings = [
      { label: 'TIME', value: String(elapsed), unit: 'S', target: s ? `of ${s.duration} s` : '' },
      { label: 'FLOW', value: fixed(m?.flow, 1), unit: 'ML/S', target: s ? `set to ${s.flow.toFixed(1)} ml/s` : '' },
      { label: 'STEAM', value: t(m?.steamTemperature), unit: tl, target: s ? `set to ${t(s.targetTemperature)}°` : '' },
    ]
    progress = s ? exact / s.duration : 0
    caption = s ? `${elapsed} OF ${s.duration} S` : ''
  } else if (kind === 'hotWater') {
    const h = wf?.hotWaterData
    const amount = hasScale ? (now - live.scaleAt < SCALE_STALE_MS ? live.scale?.weight : undefined) : volume.current.ml
    title = 'POURING'; eyebrow = hasScale ? 'HOT WATER · ON THE SCALE' : 'HOT WATER'; glyph = 'water'
    readings = [
      { label: 'TIME', value: String(elapsed), unit: 'S', target: h ? `of ${h.duration} s at most` : '' },
      { label: hasScale ? 'WEIGHT' : 'VOLUME', value: fixed(amount === undefined ? undefined : Math.max(0, amount), 0), unit: hasScale ? 'G' : 'ML', target: h ? `of ${h.volume} ${hasScale ? 'g' : 'ml'}` : '' },
      { label: 'WATER', value: t(m?.mixTemperature), unit: tl, target: h ? `set to ${t(h.targetTemperature)}°` : '' },
    ]
    progress = h && amount !== undefined ? amount / h.volume : 0
    caption = h ? `${fixed(Math.max(0, amount ?? 0), 0)} OF ${h.volume} ${hasScale ? 'G — STOPS AT WEIGHT' : 'ML'}` : ''
  } else {
    const r = wf?.rinseData
    title = 'FLUSHING'; eyebrow = 'GROUP HEAD'; glyph = 'flush'
    readings = [
      { label: 'TIME', value: String(elapsed), unit: 'S', target: r ? `of ${r.duration} s` : '' },
      { label: 'FLOW', value: fixed(m?.flow, 1), unit: 'ML/S', target: r ? `set to ${r.flow.toFixed(1)} ml/s` : '' },
      { label: 'WATER', value: t(m?.mixTemperature), unit: tl, target: r ? `set to ${t(r.targetTemperature)}°` : '' },
    ]
    progress = r ? exact / r.duration : 0
    caption = r ? `${elapsed} OF ${r.duration} S` : ''
  }

  const lit = Math.round(Math.min(1, Math.max(0, progress)) * COLS)

  return (
    <div className="run-layer">
      <div className="scrim light" />
      <section className="run display" role="dialog" aria-modal="true" aria-label={title} data-testid="run-modal" data-kind={kind}>
        <div className="run-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span className="label">{eyebrow}</span>
            <span className="dots run-title">{linkOpen ? title : 'LOST LINK'}</span>
          </div>
          <DotIcon glyph={glyph} color="var(--display-cream)" animate label={`${title}, animated`} />
        </div>
        <div className="run-readings">
          {readings.map((r) => (
            <div key={r.label} className="run-reading" data-testid={`reading-${r.label.toLowerCase()}`}>
              <span className="label">{r.label}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><span className="dots run-value">{r.value}</span><span className="label">{r.unit}</span></span>
              <span className="run-target">{r.target}</span>
            </div>
          ))}
        </div>
        <svg className="run-progress grid-patch" width={COLS * 9} height={9} viewBox={`0 0 ${COLS * 9} 9`} role="img" aria-label={`${Math.round(Math.min(1, progress) * 100)} percent done`} data-lit={lit}>
          {Array.from({ length: COLS }, (_, i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.6} fill={i < lit ? 'var(--accent)' : 'var(--display-cream)'} opacity={i < lit ? 1 : 0.18} />)}
        </svg>
        <span className="label run-caption">{caption}</span>
        <div className="run-foot">
          <span className="label" role={stop === 'failed' ? 'alert' : 'status'} data-testid="stop-status">
            {stop === 'pending' ? 'STOPPING…' : stop === 'queued' ? 'STOP SENT WHEN BACK ONLINE' : stop === 'failed' ? "DIDN'T STOP — TRY AGAIN" : ''}
          </span>
          <button type="button" className="run-stop" onClick={onStop} disabled={stop === 'pending'}>
            <DotIcon glyph="stop" color="var(--display)" primary />STOP
          </button>
        </div>
      </section>
    </div>
  )
}
