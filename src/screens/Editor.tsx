import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { nextVersion, addStageAfter, BEVERAGE_TYPES, beverageLabel, clone, deleteStage, duplicateStage, fieldSpec, moveStage, profileChanges, readField, saveProblem, setPump, writeField, exitCondition, writeExit, type StageField } from '../domain/editing'
import { planStages, type Profile, type ProfileRecord, type ProfileStep } from '../domain/profile'
import { favourites } from '../state/favourites'
import { activeProfileId, profiles } from '../state/profiles'
import { useResource } from '../state/resource'
import { saveDraft, saveOwn } from '../state/saveProfile'
import { workflow } from '../state/workflow'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Dropdown } from '../ui/Dropdown'
import { lanes, stageAtColumn, stageColumns } from '../domain/timeline'
import { ChartAxis, DotChart, AXIS_COLS } from '../ui/DotChart'
import { DotIcon } from '../ui/DotIcon'
import { fixed, NONE } from '../ui/format'
import { Ruler } from '../ui/Ruler'
import { TextSheet, ValueSheet } from '../ui/Sheets'
import { errorToast, toast } from '../ui/toasts'
import { UnsavedDialog } from '../ui/UnsavedDialog'
import { useShort } from '../ui/useShort'
import { useSize } from '../ui/useSize'
import type { EditTarget } from './Library'
import './editor.css'

// The profile editor. Chart across the top, the stage axis aligned under it, one stage's settings below.

interface Props {
  target: EditTarget
  onClose: (savedId?: string) => void
}

// About 15 characters of a stage name at the strip's size.
const STAGE_MIN_COLS = 16
const HOLD_MS = 300 // hold this long on a stage to pick it up
const MOVE_CANCEL_PX = 8 // moving further first is a scroll
const EDGE_PX = 48 // dragging this close to the strip's edge scrolls it

export function Editor({ target, onClose }: Props) {
  const all = useResource(profiles).value ?? []
  const slots = useResource(favourites).value ?? []
  const wf = useResource(workflow).value
  const source: ProfileRecord | undefined = all.find((r) => r.id === (target.kind === 'record' ? target.id : target.from))
  const [original, setOriginal] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [sel, setSel] = useState(0)
  const [field, setField] = useState<StageField | null>(null)
  const [textEdit, setTextEdit] = useState<null | 'title' | 'stage' | 'notes' | 'version'>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const savingRef = useRef(false)

  // Start from the record (your profile) or a draft of the source (a built-in copy, or New).
  useEffect(() => {
    if (draft || !source) return
    const start = clone(source.profile)
    if (target.kind === 'draft') {
      const isBasic = source.isDefault && source.profile.title === 'Default'
      start.title = isBasic ? 'New profile' : `${source.profile.title} — my copy`
      if (isBasic) { start.notes = ''; start.author = '' }
      // A version of its own makes the copy a separate profile in Decaid even before the recipe changes.
      const taken = all.filter((r) => r.profile.title === source.profile.title).map((r) => String(r.profile.version ?? ''))
      start.version = nextVersion(source.profile.version as string | undefined, taken)
    }
    setOriginal(clone(start))
    setDraft(start)
  }, [source, draft, target.kind])

  const [chartBox, chartSize] = useSize<HTMLDivElement>()
  // On a short screen the chart takes two more rows when the profile's name fits on one line (the header is a line
  // shorter); with a two-line name the stage controls need that height.
  const short = useShort()
  const [titleRef, titleSize, titleEl] = useSize<HTMLSpanElement>()
  const titleLines = titleSize.height && titleEl ? Math.round(titleSize.height / parseFloat(getComputedStyle(titleEl).lineHeight)) : 2
  const chartRows = short ? (titleLines <= 1 ? 11 : 9) : 13
  const stages = useMemo(() => (draft ? planStages(draft) : []), [draft])
  // Stage by stage, each at least STAGE_MIN_COLS wide; a profile with many stages scrolls sideways under a fixed scale.
  const available = Math.max(20, Math.floor(chartSize.width / 9) - AXIS_COLS)
  const columns = useMemo(() => stageColumns(stages.map((s) => s.t1 - s.t0), available, STAGE_MIN_COLS), [stages, available])
  const ls = useMemo(() => lanes(stages, columns), [stages, columns])
  const cols = columns.reduce((a, b) => a + b, 0) || available
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const onScroll = () => {
    const el = scroller.current
    if (el) setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }
  useEffect(onScroll, [cols, chartSize.width])
  // Keep the selected stage in view (after choosing, adding or moving one).
  useEffect(() => {
    const el = scroller.current
    const lane = ls[Math.min(sel, ls.length - 1)]
    if (!el || !lane) return
    const [x0, x1] = [lane.c0 * 9, lane.c1 * 9]
    if (x0 < el.scrollLeft) el.scrollTo({ left: x0, behavior: 'smooth' })
    else if (x1 > el.scrollLeft + el.clientWidth) el.scrollTo({ left: x1 - el.clientWidth, behavior: 'smooth' })
  }, [sel, ls])

  // Reordering: hold a stage, then drag it along the strip (as in Favourites). A quick swipe scrolls the strip,
  // a tap selects. Dragging near either edge scrolls; a bar shows where the stage will land.
  const axis = useRef<HTMLOListElement>(null)
  const press = useRef<{ i: number; x: number; y: number; scroll: number; id: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [drag, setDrag] = useState<{ from: number; dx: number; over: number } | null>(null)
  const dropped = useRef(0) // when the last drop happened: the click that follows it isn't a tap
  const onStageDown = (e: ReactPointerEvent, i: number) => {
    const { clientX: x, clientY: y, pointerId: id } = e
    const timer = setTimeout(() => { if (press.current) setDrag({ from: i, dx: 0, over: i }) }, HOLD_MS)
    press.current = { i, x, y, id, timer, scroll: scroller.current?.scrollLeft ?? 0 }
  }
  useEffect(() => {
    const el = scroller.current
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      if (!drag) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) { clearTimeout(p.timer); press.current = null }
        return
      }
      e.preventDefault()
      if (el) {
        const r = el.getBoundingClientRect()
        if (e.clientX < r.left + EDGE_PX) el.scrollLeft -= 12
        else if (e.clientX > r.right - EDGE_PX) el.scrollLeft += 12
      }
      const left = axis.current?.getBoundingClientRect().left ?? 0
      setDrag({ ...drag, dx: e.clientX - p.x + (el?.scrollLeft ?? 0) - p.scroll, over: stageAtColumn(ls, Math.max(0, Math.floor((e.clientX - left) / 9))) })
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      clearTimeout(p.timer)
      press.current = null
      if (!drag) return
      if (draft && drag.over !== drag.from) { updateProfile(moveStage(draft, drag.from, drag.over)); setSel(drag.over) }
      dropped.current = Date.now()
      setDrag(null)
    }
    const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; setDrag(null) }
    const touch = (e: TouchEvent) => { if (drag) e.preventDefault() } // the strip mustn't scroll under a drag
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', touch, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', touch)
    }
  })

  if (!draft || !original || !source) return <div className="editor" data-testid="editor" data-editing={target.kind === 'record' ? target.id : `draft:${target.from}`} />

  const step = draft.steps[Math.min(sel, draft.steps.length - 1)]
  const changes = profileChanges(original, draft)
  const dirty = changes.length > 0 || target.kind === 'draft'
  const onMachine = activeProfileId(wf?.profile, all, slots) === source.id
  // The profile this one was copied from: for your saved copies, its parent; for a draft, the source itself.
  const parent = target.kind === 'record' ? all.find((r) => r.id === source.parentId) : source
  const updateStep = (s: ProfileStep) => { setProblem(null); setDraft({ ...draft, steps: draft.steps.map((x, i) => (i === sel ? s : x)) }) }
  const updateProfile = (p: Profile) => { setProblem(null); setDraft(p) }

  const save = async (): Promise<boolean> => {
    if (savingRef.current) return false
    const why = saveProblem(draft)
    if (why) { setProblem(why); return false }
    savingRef.current = true
    setSaving(true)
    try {
      const outcome = target.kind === 'record' ? await saveOwn(source.id, draft, onMachine) : await saveDraft(draft, source, onMachine)
      if (outcome.kind === 'same') {
        setProblem(`Same recipe and version as “${outcome.record.profile.title}”. Change a stage or the version to save it as your own.`)
        return false
      }
      toast('Profile saved')
      setOriginal(clone(draft))
      onClose(outcome.record.id)
      return true
    } catch (error) {
      errorToast(error)
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const back = () => (changes.length ? setLeaving(true) : onClose())

  const subtitle = target.kind === 'record' ? 'YOUR PROFILE' : source.isDefault && source.profile.title === 'Default' ? 'NEW · NOT SAVED' : 'COPY · NOT SAVED'

  return (
    <div className="editor" data-testid="editor" data-editing={target.kind === 'record' ? target.id : `draft:${target.from}`}>
      <header className="ed-header">
        <button type="button" className="icon-button ringed" aria-label="Back" onClick={back}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <button type="button" className="ed-title" onClick={() => setTextEdit('title')} aria-label={`Name: ${draft.title || 'Untitled'}`}>
          {/* Long names step down a size and may take two lines. */}
          <span ref={titleRef} className={`ed-title-name${(draft.title ?? '').length > 40 ? ' smaller' : (draft.title ?? '').length > 22 ? ' small' : ''}`}>{draft.title || 'Untitled'}</span>
          <span className="label">{subtitle}</span>
        </button>
        <span style={{ flexGrow: 1 }} />
        <Dropdown label="Type" className="ed-prop ed-prop-type" testId="ed-type" value={(draft.beverage_type ?? 'espresso') as typeof BEVERAGE_TYPES[number]} options={BEVERAGE_TYPES.map((t) => [t, beverageLabel(t)])} onChange={(t) => updateProfile({ ...draft, beverage_type: t })}>
          <span className="label">TYPE</span><span className="ed-prop-v one-line">{beverageLabel(draft.beverage_type)}</span>
        </Dropdown>
        <button type="button" className="ed-prop ed-prop-yield" data-testid="ed-yield" onClick={() => setField('yield' as StageField)}><span className="label">YIELD</span><span className="ed-prop-v">{draft.target_weight ? `${fixed(draft.target_weight, 0)} g` : NONE}</span></button>
        <button type="button" className="ed-prop ed-prop-version" data-testid="ed-version" onClick={() => setTextEdit('version')}><span className="label">VERSION</span><span className="ed-prop-v one-line">{String(draft.version ?? '') || NONE}</span></button>
        <button type="button" className="ed-prop ed-prop-notes" onClick={() => setTextEdit('notes')}><span className="label">NOTES</span><span className="ed-prop-v">{draft.notes ? 'Edit' : 'Add'}</span></button>
        <button type="button" className="pill" onClick={() => { updateProfile(addStageAfter(draft, sel)); setSel(sel + 1) }}><DotIcon glyph="plus" />STAGE</button>
      </header>

      <div className="ed-timeline" ref={chartBox}>
        <ChartAxis rows={chartRows} />
        <div className={`ed-scroll${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`} ref={scroller} onScroll={onScroll} data-testid="ed-scroll">
          <div className="ed-chart" data-testid="ed-chart" style={{ width: cols * 9, height: chartRows * 9 }} onClick={(e) => {
            // Tapping the chart selects the stage under the finger.
            const col = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / 9)
            setSel(stageAtColumn(ls, col))
          }}>
            {chartSize.width > 0 && ls[sel] && <span className="ed-band" aria-hidden style={{ left: ls[sel].c0 * 9, width: (ls[sel].c1 - ls[sel].c0) * 9 }} />}
            {chartSize.width > 0 && <DotChart stages={stages} columns={columns} cols={cols} rows={chartRows} label={`${draft.title}: pressure and flow by stage`} />}
          </div>
          <ol className="ed-axis" aria-label="Stages" style={{ width: cols * 9 }} ref={axis} data-dragging={!!drag}>
            {drag && drag.over !== drag.from && ls[drag.over] && <span className="ed-drop" aria-hidden data-testid="ed-drop" style={{ left: (drag.over > drag.from ? ls[drag.over].c1 : ls[drag.over].c0) * 9 - 2 }} />}
            {stages.map((_, i) => {
              const st = draft.steps[i]
              const selected = i === sel
              return (
                <li key={i} style={{ width: (columns[i] ?? 0) * 9, transform: drag?.from === i ? `translateX(${drag.dx}px)` : undefined }} className={`${selected ? 'selected' : ''}${drag?.from === i ? ' dragging' : ''}`}>
                  <button type="button" aria-pressed={selected} aria-label={`Stage ${i + 1}, ${st.name || 'unnamed'}`} onPointerDown={(e) => onStageDown(e, i)} onClick={() => { if (Date.now() - dropped.current < 400) return; setSel(i) }} data-testid={`ed-stage-${i}`}>
                    <span className="ed-axis-line" aria-hidden />
                    <span className="ed-axis-name one-line">{st.name || `Stage ${i + 1}`}</span>
                    <span className="label ed-axis-meta one-line">{st.pump === 'pressure' ? 'PRES' : 'FLOW'} · {fixed(st.seconds, 0)} S</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      {/* Three columns of named groups. Inside a group the options sit close together under its name; a rule sets
          groups apart; each column's last group fills to the bottom, so the columns end together. */}
      <section className="ed-panel" aria-label={`Stage ${sel + 1}, ${step.name}`} data-testid="ed-panel">
        <div className="ed-col">
          <div className="ed-group">
            <span className="ed-group-head">STAGE {sel + 1} NAME</span>
            <button type="button" className="ed-name" onClick={() => setTextEdit('stage')} aria-label={`Stage ${sel + 1} name: ${step.name || 'Unnamed'}`}>{step.name || 'Unnamed'}</button>
          </div>
          <div className="ed-group">
            <span className="ed-group-head">TARGET</span>
            <Segmented label="CONTROL" options={[['flow', 'FLOW'], ['pressure', 'PRESSURE']]} value={step.pump} onChange={(v) => updateStep(setPump(step, v as 'flow' | 'pressure'))} />
            <FieldRuler step={step} field="target" onChange={updateStep} />
          </div>
        </div>
        <div className="ed-col">
          <div className="ed-group">
            <span className="ed-group-head">TIMING &amp; LIMIT</span>
            <Segmented label="TRANSITION" options={[['fast', 'FAST'], ['smooth', 'SMOOTH']]} value={step.transition} onChange={(v) => updateStep({ ...step, transition: v as 'fast' | 'smooth' })} />
            <FieldRuler step={step} field="seconds" onChange={updateStep} />
            <FieldRuler step={step} field="limit" onChange={updateStep} />
          </div>
        </div>
        <div className="ed-col">
          <div className="ed-group">
            <span className="ed-group-head">TEMPERATURE</span>
            <FieldRow step={step} field="temperature" onOpen={setField} label="SET TO" />
            {/* The temperature sensor, with the temperature. */}
            <Segmented label="MEASURE FROM" options={[['water', 'WATER'], ['coffee', 'COFFEE']]} value={step.sensor ?? 'coffee'} onChange={(v) => updateStep({ ...step, sensor: v as 'water' | 'coffee' })} />
          </div>
          <div className="ed-group">
            <span className="ed-group-head">MOVE TO NEXT STAGE IF</span>
            <FieldRow step={step} field="exitWeight" onOpen={setField} />
            <FieldRow step={step} field="exitVolume" onOpen={setField} />
            <FieldRow step={step} field={step.pump === 'flow' ? 'exitPressure' : 'exitFlow'} onOpen={setField} />
          </div>
        </div>
      </section>

      <div className="ed-foot">
        <div className="chips">
          <button type="button" className="chip" disabled={sel === 0} onClick={() => setSel(sel - 1)} aria-label="Previous stage">← PREVIOUS</button>
          <button type="button" className="chip" disabled={sel >= draft.steps.length - 1} onClick={() => setSel(sel + 1)} aria-label="Next stage">NEXT →</button>
          <button type="button" className="chip" onClick={() => { updateProfile(duplicateStage(draft, sel)); setSel(sel + 1) }}>DUPLICATE STAGE</button>
          <button type="button" className="chip" disabled={draft.steps.length <= 1} onClick={() => setConfirmDelete(true)}>DELETE STAGE</button>
          {parent && <button type="button" className="chip" onClick={() => { updateProfile({ ...draft, steps: clone(parent.profile.steps), target_weight: parent.profile.target_weight, beverage_type: parent.profile.beverage_type }); setSel(0) }}>RESET TO ORIGINAL</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          {problem && <span className="ed-problem" role="alert" data-testid="ed-problem">{problem}</span>}
          <button type="button" className="save ed-save" disabled={saving || !dirty} onClick={() => void save()}><DotIcon glyph="check" color="var(--on-primary)" />SAVE</button>
        </div>
      </div>

      {field && <ValueSheet
        title={field === ('yield' as StageField) ? 'TARGET YIELD' : `${fieldSpec(field, step).label} · ${step.name.toUpperCase()}`}
        spec={field === ('yield' as StageField) ? { label: 'TARGET YIELD', unit: 'G', min: 0, max: 250, step: 0.5, decimals: 1, offable: true } : fieldSpec(field, step)}
        value={field === ('yield' as StageField) ? (draft.target_weight || null) : readField(step, field)}
        onCancel={() => setField(null)}
        choice={field === 'exitPressure' || field === 'exitFlow' ? { label: 'Above or below', options: [['over', 'ABOVE'], ['under', 'BELOW']], value: exitCondition(step, field === 'exitPressure' ? 'pressure' : 'flow') } : undefined}
        onDone={(v, c) => {
          if (field === ('yield' as StageField)) updateProfile({ ...draft, target_weight: v ?? 0 })
          else if (field === 'exitPressure' || field === 'exitFlow') updateStep(writeExit(step, field === 'exitPressure' ? 'pressure' : 'flow', c as 'over' | 'under', v))
          else updateStep(writeField(step, field, v))
          setField(null)
        }}
      />}

      {textEdit && <TextSheet
        label={textEdit === 'title' ? 'PROFILE NAME' : textEdit === 'stage' ? `STAGE ${sel + 1} NAME` : textEdit === 'version' ? 'VERSION' : 'NOTES'}
        multiline={textEdit === 'notes'}
        value={textEdit === 'title' ? draft.title : textEdit === 'stage' ? step.name : textEdit === 'version' ? String(draft.version ?? '') : String(draft.notes ?? '')}
        onCancel={() => setTextEdit(null)}
        onDone={(v) => {
          if (textEdit === 'title') updateProfile({ ...draft, title: v })
          else if (textEdit === 'stage') updateStep({ ...step, name: v })
          else if (textEdit === 'version') updateProfile({ ...draft, version: v.slice(0, 20) })
          else updateProfile({ ...draft, notes: v })
          setTextEdit(null)
        }}
      />}

      {confirmDelete && <ConfirmDialog
        eyebrow="DELETE STAGE"
        title={`Delete “${step.name || `Stage ${sel + 1}`}”?`}
        holdLabel="HOLD TO DELETE"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); updateProfile(deleteStage(draft, sel)); setSel(Math.max(0, sel - 1)) }}
      />}

      {leaving && <UnsavedDialog
        context={`UNSAVED CHANGES · ${draft.title.toUpperCase()}`}
        changes={changes}
        onKeep={() => setLeaving(false)}
        onDiscard={() => { setLeaving(false); onClose() }}
        onSave={async () => { setLeaving(false); await save() }}
      />}
    </div>
  )
}

function Segmented({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ed-seg-wrap">
      <span className="label">{label}</span>
      <div role="group" aria-label={label} className="ed-seg">
        {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </div>
  )
}

function FieldRow({ step, field, onOpen, label }: { step: ProfileStep; field: StageField; onOpen: (f: StageField) => void; label?: string }) {
  const spec = fieldSpec(field, step)
  const v = readField(step, field)
  return (
    <button type="button" className={`ed-row${v === null ? ' off' : ''}`} onClick={() => onOpen(field)} data-testid={`ed-field-${field}`}>
      <span className="label">{label ?? spec.label}</span>
      {/* Number in serif, unit in the small mono caps — the same in every row. */}
      {v === null ? <span className="ed-row-v">{NONE}</span> : <span className="ed-target-v"><span>{fixed(v, spec.decimals)}</span><span className="label">{spec.unit}</span></span>}
    </button>
  )
}

// A value on one row with its ruler right under it (the target, duration, limit). A value that can be off shows
// OFF while it's on; when it's off the ruler is dimmed and moving it turns the value back on.
function FieldRuler({ step, field, onChange }: { step: ProfileStep; field: StageField; onChange: (s: ProfileStep) => void }) {
  const spec = fieldSpec(field, step)
  const raw = readField(step, field)
  const v = raw ?? spec.min
  return (
    <>
      <div className={`ed-row ed-target${raw === null ? ' off' : ''}`} data-testid={`ed-field-${field}`}>
        <span className="label">{spec.label}</span>
        <span className="ed-row-end">
          {raw === null
            ? <span className="ed-row-v">{NONE}</span>
            : <span className="ed-target-v"><span data-testid={field === 'target' ? 'ed-target' : undefined}>{fixed(raw, spec.decimals)}</span><span className="label">{spec.unit}</span></span>}
          {spec.offable && raw !== null && <button type="button" className="chip" aria-label={`${spec.label} off`} onClick={() => onChange(writeField(step, field, null))}>OFF</button>}
        </span>
      </div>
      <div className={`ed-ruler${raw === null ? ' off' : ''}`}>
        <Ruler compact value={v} min={spec.min} max={spec.max} step={spec.step} decimals={spec.decimals} label={`${spec.label} ruler`} onChange={(x) => onChange(writeField(step, field, x))} />
      </div>
    </>
  )
}

