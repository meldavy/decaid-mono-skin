import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { favourites } from '../state/favourites'
import { scaleConnected, useLive } from '../state/live'
import { DEFAULT_TARGET_TIME, prefsResource, saveTargetTime, targetTimes, withDefaults } from '../state/prefs'
import { activeProfileId, profiles } from '../state/profiles'
import { useResource } from '../state/resource'
import { saveWorkflow, workflow } from '../state/workflow'
import { DotIcon } from '../ui/DotIcon'
import { Ruler, useHoldRepeat } from '../ui/Ruler'
import { toast } from '../ui/toasts'
import { fromShown, inUnits, ratio, readValue, SHEETS, toShown, VALUES, workflowPatch, type SheetKind, type ValueId, type ValueSpec } from './values'
import './sheet.css'

interface Props {
  kind: SheetKind
  onClose: () => void
}

interface Edit {
  value: number // °C / g / ml / s, as stored
  original: number // what Decaid held when the person started editing
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'partial'; failed: ValueId[] } | { kind: 'error'; message: string }

const RECENT_KEY = (id: ValueId) => `mono.recent.${id}`
function recents(id: ValueId): number[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY(id)) ?? '[]') as number[]
  } catch {
    return []
  }
}
function remember(id: ValueId, value: number) {
  try {
    localStorage.setItem(RECENT_KEY(id), JSON.stringify([value, ...recents(id).filter((v) => v !== value)].slice(0, 5)))
  } catch {
    // Browser storage unavailable: presets fall back to the defaults.
  }
}

const UNIT_LABEL = { g: 'G', ml: 'ML', s: 'S' } as const

export function RulerSheet({ kind, onClose }: Props) {
  const ids = SHEETS[kind] as readonly ValueId[]
  const [tab, setTab] = useState<ValueId>(ids[0])
  const [edits, setEdits] = useState<Partial<Record<ValueId, Edit>>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const saving = useRef(false)

  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const records = useResource(profiles).value ?? []
  const slots = useResource(favourites).value ?? []
  const targets = useResource(targetTimes).value ?? {}
  const hasScale = useLive((l) => scaleConnected(l.devices))
  const activeId = activeProfileId(wf?.profile, records, slots)
  const shotTarget = (activeId && targets[activeId]) || DEFAULT_TARGET_TIME
  const units = prefs.units

  const current = (id: ValueId) => (wf ? readValue(id, wf, shotTarget) : 0)
  const valueOf = (id: ValueId) => edits[id]?.value ?? current(id)
  const changed = ids.filter((id) => edits[id] !== undefined && edits[id]!.value !== current(id))

  const setValue = (id: ValueId, value: number) => {
    setStatus({ kind: 'idle' })
    setEdits((e) => ({ ...e, [id]: { value, original: e[id]?.original ?? current(id) } }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (saving.current || !wf) return
    if (!changed.length) return onClose()
    saving.current = true
    setStatus({ kind: 'saving' })
    const values = Object.fromEntries(changed.map((id) => [id, edits[id]!.value])) as Partial<Record<ValueId, number>>
    const failed: ValueId[] = []
    const workflowIds = changed.filter((id) => VALUES[id].where !== 'mono')
    const tasks: Promise<void>[] = []
    if (workflowIds.length) {
      tasks.push(saveWorkflow(workflowPatch(values, wf)).then(() => undefined, () => { failed.push(...workflowIds) }))
    }
    if (values.shotTarget !== undefined) {
      tasks.push(
        activeId
          ? saveTargetTime(activeId, values.shotTarget).catch(() => { failed.push('shotTarget') })
          : Promise.resolve().then(() => { failed.push('shotTarget') }),
      )
    }
    await Promise.all(tasks)
    saving.current = false
    changed.filter((id) => !failed.includes(id)).forEach((id) => remember(id, values[id]!))
    if (!failed.length) {
      toast('Saved')
      onClose()
    } else if (failed.length === changed.length) {
      setStatus({ kind: 'error', message: "Couldn't save. Decaid didn't accept the change — try again." })
    } else {
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => failed.includes(id as ValueId))))
      setStatus({ kind: 'partial', failed })
    }
  }

  // Swipe the handle down to dismiss.
  const swipe = useRef<{ y: number; id: number } | null>(null)
  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    swipe.current = { y: e.clientY, id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId) // keep receiving the release once the finger leaves the handle
  }
  const onHandleUp = (e: PointerEvent) => {
    if (swipe.current && swipe.current.id === e.pointerId && e.clientY - swipe.current.y > 80) onClose()
    swipe.current = null
  }

  const spec = inUnits(VALUES[tab], units)
  const shown = toShown(VALUES[tab], units, valueOf(tab))
  const isOff = VALUES[tab].off !== undefined && valueOf(tab) === VALUES[tab].off
  const step = (dir: 1 | -1) => {
    const next = Math.min(spec.max, Math.max(spec.min, Number((shown + dir * spec.step).toFixed(spec.decimals))))
    setValue(tab, fromShown(VALUES[tab], units, isOff ? spec.min : next))
  }
  const minus = useHoldRepeat(() => step(-1))
  const plus = useHoldRepeat(() => step(1))

  const presetList = (() => {
    const own = recents(tab).map((v) => toShown(VALUES[tab], units, v))
    const merged = [...own, ...spec.presets].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5).sort((a, b) => a - b)
    return VALUES[tab].off !== undefined ? [VALUES[tab].off!, ...merged.slice(0, 4)] : merged
  })()

  const unitText = (s: ValueSpec) => (s.unit === 'temp' ? (units === 'f' ? '°F' : '°C') : UNIT_LABEL[s.unit])
  const conflict = edits[tab] && edits[tab]!.original !== current(tab)

  return (
    <div className="sheet-layer">
      <div className="scrim" data-testid="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`Adjust ${kind}`}>
        <div className="sheet-handle" onPointerDown={onHandleDown} onPointerUp={onHandleUp} data-testid="sheet-handle"><span /></div>

        <div role="tablist" className="sheet-tabs" style={{ gridTemplateColumns: `repeat(${ids.length}, minmax(0, 1fr))` }}>
          {ids.map((id) => {
            const s = VALUES[id]
            const v = valueOf(id)
            const off = s.off !== undefined && v === s.off
            return (
              <button key={id} type="button" role="tab" aria-selected={id === tab} className="sheet-tab" onClick={() => setTab(id)} data-testid={`tab-${id}`}>
                <span className="label">{s.label} {unitText(s)}{edits[id] && v !== current(id) ? ' ·' : ''}</span>
                <span className="tab-value">{off ? 'OFF' : toShown(s, units, v).toFixed(inUnits(s, units).decimals)}</span>
                {id === 'espressoYield' && (
                  <span className="label ratio" data-testid="ratio">{ratio(v, wf?.context?.targetDoseWeight ?? 0)}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="sheet-focus">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="label one-line" data-testid="sheet-focus-label">{focusLabel(tab, wf?.profile.title)}</span>
            <span className="sheet-note" data-testid="sheet-note">{conflict ? 'Changed on another device. Save to keep yours.' : note(tab, hasScale)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button type="button" className="round" aria-label="Decrease" {...minus}>−</button>
            <button type="button" className="round" aria-label="Increase" {...plus}>+</button>
          </div>
        </div>

        {isOff ? (
          <div className="sheet-off label">STEAM HEATER OFF</div>
        ) : (
          <Ruler value={shown} min={spec.min} max={spec.max} step={spec.step} decimals={spec.decimals} label={`${VALUES[tab].label} ruler`} onChange={(v) => setValue(tab, fromShown(VALUES[tab], units, v))} />
        )}

        <div className="sheet-presets">
          <span className="label" style={{ marginRight: 8 }}>PRESETS</span>
          {presetList.map((p) => {
            const isCurrent = p === (isOff ? VALUES[tab].off : shown)
            return (
              <button key={p} type="button" aria-pressed={isCurrent} className="preset" onClick={() => setValue(tab, fromShown(VALUES[tab], units, p))}>
                {p === VALUES[tab].off ? 'OFF' : p.toFixed(spec.decimals)}
              </button>
            )
          })}
        </div>

        <div className="sheet-footer">
          <span className="label" data-testid="sheet-status" role={status.kind === 'error' || status.kind === 'partial' ? 'alert' : undefined}>
            {status.kind === 'saving' ? 'SAVING…'
              : status.kind === 'error' ? status.message.toUpperCase()
              : status.kind === 'partial' ? `SAVED SOME · ${status.failed.map((id) => VALUES[id].label).join(', ')} DIDN'T SAVE`
              : ''}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onClose}>CANCEL</button>
            <button type="button" className="save" onClick={save} disabled={status.kind === 'saving'}>
              <DotIcon glyph="check" color="var(--on-primary)" />SAVE
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function focusLabel(id: ValueId, title?: string) {
  switch (id) {
    case 'espressoTemp': case 'espressoYield': case 'dose': return `${VALUES[id].label} · ${title?.toUpperCase() ?? ''}`
    case 'shotTarget': return 'SHOT TARGET'
    case 'hotWaterMax': return 'HOT WATER · LONGEST RUN'
    case 'steamMax': return 'STEAM · LONGEST RUN'
    case 'flushTime': return 'FLUSH · HOW LONG'
    case 'hotWaterAmount': return 'HOT WATER · AMOUNT'
    default: return VALUES[id].label
  }
}

// What the value does, where that isn't obvious: the shot target stops nothing, and without a scale weight targets don't either.
function note(id: ValueId, hasScale: boolean) {
  if (id === 'shotTarget') return 'This is your shot target time, a baseline used to compare against your actual shot finish time.'
  if (hasScale) return ''
  if (id === 'espressoYield') return 'The shot will stop at this weight when a scale is connected.'
  if (id === 'hotWaterAmount') return 'Hot water will stop by volume until a scale is connected.'
  return ''
}
