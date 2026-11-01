import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { planStages, type ProfileRecord } from '../domain/profile'
import { favourites, saveFavourites, SLOT_COUNT, type Slots } from '../state/favourites'
import { prefsResource, withDefaults } from '../state/prefs'
import { activeProfileId, profiles } from '../state/profiles'
import { useResource } from '../state/resource'
import { workflow } from '../state/workflow'
import { DotChart } from '../ui/DotChart'
import { DotIcon } from '../ui/DotIcon'
import { errorToast, toast } from '../ui/toasts'
import { UnsavedDialog, type Change } from '../ui/UnsavedDialog'
import type { EditTarget } from './Library'
import { kindLabel, ProfileDetail, slotNo } from './ProfileDetail'
import './favourites.css'

// The favourites manager. The five shared favourite slots on top, the rest of the library below. Hold a profile and drop it on a slot
// (or drag one slot onto another to swap). Tapping a profile opens its details. Nothing is saved until Done.

const HOLD_MS = 280
const MOVE_CANCEL_PX = 10

interface Props {
  onBack: () => void
  onEdit: (target: EditTarget) => void
}

type DragSource = { kind: 'slot'; index: number } | { kind: 'library'; id: string }
interface Drag { source: DragSource; record: ProfileRecord; x: number; y: number; over: number | null }


export function Favourites({ onBack, onEdit }: Props) {
  const all = useResource(profiles).value ?? []
  const saved = useResource(favourites).value ?? new Array<string | null>(SLOT_COUNT).fill(null)
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const [slots, setSlots] = useState<Slots | null>(null) // local edits; null = not touched yet
  const current = slots ?? saved
  const activeId = activeProfileId(wf?.profile, all, current)
  const activeSlot = activeId ? current.indexOf(activeId) : -1 // first match only, if a profile is in two slots
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [detail, setDetail] = useState<ProfileRecord | null>(null)
  const [leaving, setLeaving] = useState<null | (() => void)>(null)
  const [saving, setSaving] = useState(false)
  const press = useRef<{ source: DragSource; record: ProfileRecord; x: number; y: number; timer: ReturnType<typeof setTimeout>; id: number } | null>(null)

  const dirty = !!slots && slots.some((id, i) => id !== saved[i])
  const library = all
    .filter((r) => r.visibility === 'visible' && !current.includes(r.id))
    .filter((r) => r.profile.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.profile.title.localeCompare(b.profile.title))

  const assign = (index: number, id: string | null) => {
    const next = [...current]
    const from = next.indexOf(id ?? '')
    if (id && from >= 0) next[from] = next[index] // already in a slot: swap the two
    next[index] = id
    setSlots(next)
  }
  const swap = (a: number, b: number) => {
    const next = [...current]
    ;[next[a], next[b]] = [next[b], next[a]]
    setSlots(next)
  }

  // Hold, then drag. A short press is a tap (details). Moving before the hold is a scroll, not a drag.
  const onDown = (e: ReactPointerEvent, source: DragSource, record: ProfileRecord | undefined) => {
    if (!record) return
    const { clientX: x, clientY: y, pointerId: id } = e
    const timer = setTimeout(() => {
      if (!press.current) return
      setDrag({ source, record, x: press.current.x, y: press.current.y, over: null })
    }, HOLD_MS)
    press.current = { source, record, x, y, timer, id }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      if (!drag) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) { clearTimeout(p.timer); press.current = null }
        return
      }
      e.preventDefault()
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]')
      setDrag({ ...drag, x: e.clientX, y: e.clientY, over: el ? Number(el.dataset.slot) : null })
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      clearTimeout(p.timer)
      press.current = null
      if (!drag) { setDetail(p.record); return } // a tap
      if (drag.over !== null) {
        if (drag.source.kind === 'slot') { if (drag.source.index !== drag.over) swap(drag.source.index, drag.over) }
        else assign(drag.over, drag.source.id)
      }
      setDrag(null) // dropped elsewhere: nothing changes
    }
    const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; setDrag(null) }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  })

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (dirty) { await saveFavourites(current); toast('Favourites saved') }
      setSlots(null)
      return true
    } catch (error) {
      errorToast(error)
      return false
    } finally {
      setSaving(false)
    }
  }
  const leave = (go: () => void) => (dirty ? setLeaving(() => go) : go())
  const changes: Change[] = current.flatMap((id, i) => (id !== saved[i]
    ? [{ what: `Slot ${slotNo(i)}`, from: saved[i] ? byId.get(saved[i]!)?.profile.title ?? '—' : 'Empty', to: id ? byId.get(id)?.profile.title ?? '—' : 'Empty' }]
    : []))

  return (
    <div className="favs" data-testid="favourites" data-dragging={!!drag}>
      <header className="lib-header">
        <button type="button" className="icon-button ringed" aria-label="Back to profiles" onClick={() => leave(onBack)}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <h1 className="lib-title">Favourites</h1>
        <span style={{ flexGrow: 1 }} />
        <span className="label">HOLD A PROFILE · DROP IT ON A SLOT</span>
      </header>

      <section className="favs-five">
        <div className="favs-slots">
          {current.map((id, i) => {
            const r = id ? byId.get(id) : undefined
            const target = drag && drag.over === i
            return (
              <div
                key={i}
                data-slot={i}
                className={`fav-slot${r ? '' : ' empty'}${target ? ' target' : ''}${i === activeSlot ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={r ? `Slot ${i + 1}, ${r.profile.title}` : `Slot ${i + 1}, empty`}
                onPointerDown={(e) => onDown(e, { kind: 'slot', index: i }, r)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && r) setDetail(r) }}
              >
                <span className="fav-slot-top label"><span>{slotNo(i)}</span><span>{target ? 'DROP TO SWAP' : i === activeSlot ? '● ACTIVE' : ''}</span></span>
                <span className="fav-slot-name">{r ? breakable(r.profile.title) || 'Untitled' : 'Empty'}</span>
                <span className="label fav-slot-note">{target && r ? 'RETURNS TO LIBRARY' : ''}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="favs-lib-head">
        <span className="label">LIBRARY · {library.length} MORE</span>
        <label className="lib-search favs-search">
          <DotIcon glyph="search" color="var(--taupe)" />
          <input type="search" aria-label="Search the library" placeholder="SEARCH" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="favs-grid" data-testid="favs-grid">
        {library.map((r) => (
          <div key={r.id} className={`fav-card${drag?.source.kind === 'library' && drag.source.id === r.id ? ' lifted' : ''}`} role="button" tabIndex={0} aria-label={r.profile.title || 'Untitled'}
            onPointerDown={(e) => onDown(e, { kind: 'library', id: r.id }, r)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDetail(r) }}>
            <span className="fav-card-text"><span className="fav-card-name">{breakable(r.profile.title) || 'Untitled'}</span><span className="label one-line">{kindLabel(r)}</span></span>
            <DotChart stages={planStages(r.profile)} mode="field" cols={22} rows={4} label="" />
          </div>
        ))}
        {!library.length && <div className="lib-empty">{query ? `Nothing matches “${query}”.` : 'Every profile is a favourite.'}</div>}
      </div>

      <div className="favs-foot">
        <span />
        <button type="button" className="save" disabled={saving} onClick={async () => { if (await save()) onBack() }}><DotIcon glyph="check" color="#fff" />DONE</button>
      </div>

      {drag && (
        <div className="fav-ghost" style={{ left: drag.x - 126, top: drag.y - 40 }} aria-hidden data-testid="drag-ghost">
          <span className="fav-card-name">{drag.record.profile.title}</span>
          <span className="label">{kindLabel(drag.record)}</span>
        </div>
      )}

      {detail && (
        <FavDetail
          record={detail}
          slots={current}
          units={prefs.units}
          onClose={() => setDetail(null)}
          onRemove={() => { const i = current.indexOf(detail.id); if (i >= 0) assign(i, null); setDetail(null) }}
          onEdit={(target) => leave(() => onEdit(target))}
        />
      )}

      {leaving && (
        <UnsavedDialog
          context="UNSAVED CHANGES · FAVOURITES"
          changes={changes}
          onKeep={() => setLeaving(null)}
          onDiscard={() => { const go = leaving; setLeaving(null); setSlots(null); go() }}
          onSave={async () => { const go = leaving; setLeaving(null); if (await save()) go() }}
        />
      )}
    </div>
  )
}

interface DetailProps {
  record: ProfileRecord
  slots: Slots
  units: 'c' | 'f'
  onClose: () => void
  onEdit: (target: EditTarget) => void
  onRemove?: () => void // only in the Favourites manager
}

// The profile, with its edit buttons: a built-in can only be edited as a copy; your own can be edited or copied.
// In the Favourites manager, one of the five can also be removed (slots themselves change by dragging).
export function FavDetail({ record, slots, units, onClose, onEdit, onRemove }: DetailProps) {
  const inSlot = slots.indexOf(record.id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onClose} data-testid="detail-scrim" />
      <section className="fav-detail" role="dialog" aria-modal="true" aria-label={record.profile.title} data-testid="fav-detail">
        <button type="button" className="icon-button ringed fav-detail-close" aria-label="Close" onClick={onClose}><DotIcon glyph="close" color="var(--brown-ink)" /></button>
        <ProfileDetail record={record} slot={inSlot} onMachine={false} units={units} tall />
        <div className="fav-detail-actions">
          {record.isDefault
            ? <button type="button" className="chip" onClick={() => onEdit({ kind: 'draft', from: record.id })}>EDIT A COPY</button>
            : <>
                <button type="button" className="chip" onClick={() => onEdit({ kind: 'record', id: record.id })}>EDIT</button>
                <button type="button" className="chip" onClick={() => onEdit({ kind: 'draft', from: record.id })}>COPY</button>
              </>}
          {inSlot >= 0 && onRemove && <button type="button" className="chip" onClick={onRemove}>REMOVE FROM SLOT</button>}
        </div>
      </section>
    </div>
  )
}

// Names like "Cleaning/Weber Spring Clean" may wrap after a slash instead of mid-word.
const breakable = (title: string) => title.replace(/\//g, '/\u200b')
