import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { planStages, type ProfileRecord } from '../domain/profile'
import { favourites, SLOT_COUNT, type Slots } from '../state/favourites'
import { dye2Selection, recipeSlots, sameEntry, saveSlotEntries, slotEntries, type Entry } from '../state/recipeSlots'
import { recipeCoffee, recipeName, recipeProfile, recipes, type Recipe } from '../state/recipes'
import { RecipeView } from './RecipeView'
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
import './history.css' // hist-sub, for a recipe's coffee line

// The favourites manager. The five shared favourite slots on top, the rest of the library below. Hold a profile and drop it on a slot
// (or drag one slot onto another to swap). Tapping a profile opens its details. Nothing is saved until Done.
// From Beans the library below is recipes: a slot holds a profile or a recipe, whichever was dropped on it.

const HOLD_MS = 280
const MOVE_CANCEL_PX = 10

interface Props {
  onBack: () => void
  onEdit: (target: EditTarget) => void
  library?: 'profiles' | 'recipes'
}

type DragSource = { kind: 'slot'; index: number } | { kind: 'library'; entry: Entry }
// What a card shows, whichever kind it is.
interface Item { entry: Entry; name: string; sub: string; record?: ProfileRecord; recipe?: Recipe }
interface Drag { source: DragSource; item: Item; x: number; y: number; over: number | null }


export function Favourites({ onBack, onEdit, library: kind = 'profiles' }: Props) {
  const all = useResource(profiles).value ?? []
  const sharedSlots = useResource(favourites).value ?? new Array<string | null>(SLOT_COUNT).fill(null)
  const notes = useResource(recipeSlots).value
  const allRecipes = useResource(recipes).value ?? []
  const selection = useResource(dye2Selection).value
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const recipesById = useMemo(() => new Map(allRecipes.map((r) => [r.id, r])), [allRecipes])
  const saved = useMemo(() => slotEntries(sharedSlots, notes, new Set(recipesById.keys())), [sharedSlots, notes, recipesById])
  const [slots, setSlots] = useState<(Entry | null)[] | null>(null) // local edits; null = not touched yet
  const current = slots ?? saved
  const profileIds: Slots = current.map((e) => (e?.kind === 'profile' ? e.id : null))
  const activeId = activeProfileId(wf?.profile, all, profileIds)
  const recipeActive = selection?.kind === 'recipe' ? current.findIndex((e) => e?.kind === 'recipe' && e.id === selection.id) : -1
  const activeSlot = recipeActive >= 0 ? recipeActive : activeId ? profileIds.indexOf(activeId) : -1 // first match only
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [detail, setDetail] = useState<Item | null>(null)
  const [leaving, setLeaving] = useState<null | (() => void)>(null)
  const [saving, setSaving] = useState(false)
  const press = useRef<{ source: DragSource; item: Item; x: number; y: number; timer: ReturnType<typeof setTimeout>; id: number } | null>(null)

  const itemOf = (e: Entry | null): Item | undefined => {
    if (!e) return undefined
    if (e.kind === 'profile') { const r = byId.get(e.id); return r ? { entry: e, name: r.profile.title, sub: kindLabel(r), record: r } : undefined }
    const r = recipesById.get(e.id)
    return r ? { entry: e, name: recipeName(r), sub: ['RECIPE', recipeCoffee(r)].filter(Boolean).join(' · ').toUpperCase(), recipe: r } : undefined
  }
  const dirty = !!slots && slots.some((e, i) => !sameEntry(e, saved[i]))
  const q = query.trim().toLowerCase()
  const inSlots = (e: Entry) => current.some((c) => sameEntry(c, e))
  const library: Item[] = kind === 'recipes'
    ? allRecipes.map((r) => itemOf({ kind: 'recipe', id: r.id })!).filter((it) => !inSlots(it.entry) && (it.name.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q)))
    : all.filter((r) => r.visibility === 'visible' && !inSlots({ kind: 'profile', id: r.id }) && r.profile.title.toLowerCase().includes(q)).map((r) => itemOf({ kind: 'profile', id: r.id })!)
  library.sort((a, b) => a.name.localeCompare(b.name))

  const assign = (index: number, entry: Entry | null) => {
    const next = [...current]
    const from = entry ? next.findIndex((e) => sameEntry(e, entry)) : -1
    if (entry && from >= 0) next[from] = next[index] // already in a slot: swap the two
    next[index] = entry
    setSlots(next)
  }
  const swap = (a: number, b: number) => {
    const next = [...current]
    ;[next[a], next[b]] = [next[b], next[a]]
    setSlots(next)
  }

  // Hold, then drag. A short press is a tap (details). Moving before the hold is a scroll, not a drag.
  const onDown = (e: ReactPointerEvent, source: DragSource, item: Item | undefined) => {
    if (!item) return
    const { clientX: x, clientY: y, pointerId: id } = e
    const timer = setTimeout(() => {
      if (!press.current) return
      setDrag({ source, item, x: press.current.x, y: press.current.y, over: null })
    }, HOLD_MS)
    press.current = { source, item, x, y, timer, id }
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
      if (!drag) { setDetail(p.item); return } // a tap
      if (drag.over !== null) {
        if (drag.source.kind === 'slot') { if (drag.source.index !== drag.over) swap(drag.source.index, drag.over) }
        else assign(drag.over, drag.source.entry)
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
      if (dirty) { await saveSlotEntries(current, recipesById); toast('Favourites saved') }
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
  const nameOf = (e: Entry | null) => (e ? itemOf(e)?.name ?? '—' : 'Empty')
  const changes: Change[] = current.flatMap((e, i) => (!sameEntry(e, saved[i]) ? [{ what: `Slot ${slotNo(i)}`, from: nameOf(saved[i]), to: nameOf(e) }] : []))

  return (
    <div className="favs" data-testid="favourites" data-dragging={!!drag}>
      <header className="lib-header">
        <button type="button" className="icon-button ringed" aria-label={kind === 'recipes' ? 'Back to beans' : 'Back to profiles'} onClick={() => leave(onBack)}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <h1 className="lib-title">Favourites</h1>
        <span style={{ flexGrow: 1 }} />
        <span className="label">HOLD A {kind === 'recipes' ? 'RECIPE' : 'PROFILE'} · DROP IT ON A SLOT</span>
      </header>

      <section className="favs-five">
        <div className="favs-slots">
          {current.map((entry, i) => {
            const r = itemOf(entry)
            const target = drag && drag.over === i
            return (
              <div
                key={i}
                data-slot={i}
                className={`fav-slot${r ? '' : ' empty'}${target ? ' target' : ''}${i === activeSlot ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={r ? `Slot ${i + 1}, ${r.name}` : `Slot ${i + 1}, empty`}
                onPointerDown={(e) => onDown(e, { kind: 'slot', index: i }, r)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && r) setDetail(r) }}
              >
                <span className="fav-slot-top label"><span>{slotNo(i)}{r?.recipe ? ' · RECIPE' : ''}</span><span>{target ? 'DROP TO SWAP' : i === activeSlot ? '● ACTIVE' : ''}</span></span>
                <span className="fav-slot-name">{r ? breakable(r.name) || 'Untitled' : 'Empty'}</span>
                <span className="label fav-slot-note">{target && r ? 'RETURNS TO LIBRARY' : ''}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="favs-lib-head">
        <span className="label">{kind === 'recipes' ? 'RECIPES' : 'LIBRARY'} · {library.length} MORE</span>
        <label className="lib-search favs-search">
          <DotIcon glyph="search" color="var(--taupe)" />
          <input type="search" aria-label="Search the library" placeholder="SEARCH" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="favs-grid" data-testid="favs-grid">
        {library.map((it) => {
          const p = it.record?.profile ?? (it.recipe ? recipeProfile(it.recipe) : null)
          return (
            <div key={`${it.entry.kind}:${it.entry.id}`} className={`fav-card${drag?.source.kind === 'library' && sameEntry(drag.source.entry, it.entry) ? ' lifted' : ''}`} role="button" tabIndex={0} aria-label={it.name || 'Untitled'}
              onPointerDown={(e) => onDown(e, { kind: 'library', entry: it.entry }, it)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDetail(it) }}>
              <span className="fav-card-text"><span className="fav-card-name">{breakable(it.name) || 'Untitled'}</span><span className="label one-line">{it.sub}</span></span>
              {p && <DotChart stages={planStages(p)} mode="field" cols={22} rows={4} label="" />}
            </div>
          )
        })}
        {!library.length && <div className="lib-empty">{query ? `Nothing matches “${query}”.` : kind === 'recipes' ? (allRecipes.length ? 'Every recipe is a favourite.' : 'No recipes yet. Save one from a shot in History.') : 'Every profile is a favourite.'}</div>}
      </div>

      <div className="favs-foot">
        <span />
        <button type="button" className="save" disabled={saving} onClick={async () => { if (await save()) onBack() }}><DotIcon glyph="check" color="var(--on-primary)" />DONE</button>
      </div>

      {drag && (
        <div className="fav-ghost" style={{ left: drag.x - 126, top: drag.y - 40 }} aria-hidden data-testid="drag-ghost">
          <span className="fav-card-name">{drag.item.name}</span>
          <span className="label">{drag.item.sub}</span>
        </div>
      )}

      {detail?.record && (
        <FavDetail
          record={detail.record}
          slots={profileIds}
          units={prefs.units}
          onClose={() => setDetail(null)}
          onRemove={() => { const i = current.findIndex((e) => sameEntry(e, detail.entry)); if (i >= 0) assign(i, null); setDetail(null) }}
          onEdit={(target) => leave(() => onEdit(target))}
        />
      )}
      {detail?.recipe && (
        <RecipeFavDetail recipe={detail.recipe} units={prefs.units} inSlot={current.findIndex((e) => sameEntry(e, detail.entry))}
          onClose={() => setDetail(null)}
          onRemove={() => { const i = current.findIndex((e) => sameEntry(e, detail.entry)); if (i >= 0) assign(i, null); setDetail(null) }} />
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

// A recipe tapped in the manager: its details as on the Beans screen, and Remove from slot when it holds one.
function RecipeFavDetail({ recipe, inSlot, units, onClose, onRemove }: { recipe: Recipe; inSlot: number; units: 'c' | 'f'; onClose: () => void; onRemove: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onClose} data-testid="detail-scrim" />
      <section className="fav-detail" role="dialog" aria-modal="true" aria-label={recipeName(recipe)} data-testid="fav-detail">
        <button type="button" className="icon-button ringed fav-detail-close" aria-label="Close" onClick={onClose}><DotIcon glyph="close" color="var(--brown-ink)" /></button>
        <RecipeView recipe={recipe} units={units} slot={inSlot} tall />
        {inSlot >= 0 && <div className="fav-detail-actions"><button type="button" className="chip" onClick={onRemove}>REMOVE FROM SLOT</button></div>}
      </section>
    </div>
  )
}

// Names like "Cleaning/Weber Spring Clean" may wrap after a slash instead of mid-word.
const breakable = (title: string) => title.replace(/\//g, '/\u200b')
