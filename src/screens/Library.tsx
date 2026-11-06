import { useEffect, useMemo, useRef, useState } from 'react'
import { planStages, type ProfileRecord } from '../domain/profile'
import { favourites } from '../state/favourites'
import { prefsResource, withDefaults } from '../state/prefs'
import { activeProfileId, createProfile, deleteProfile, loadProfile, parseProfileFile, profiles, setVisibility, type ProfileRecordFull } from '../state/profiles'
import { useResource } from '../state/resource'
import { workflow } from '../state/workflow'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DotChart } from '../ui/DotChart'
import { DotIcon } from '../ui/DotIcon'
import { errorToast, toast } from '../ui/toasts'
import { parseTclProfile } from '../import/tcl'
import { kindLabel, ProfileDetail, slotNo } from './ProfileDetail'
import './library.css'

type Filter = 'all' | 'favourites' | 'builtin' | 'mine' | 'hidden'
type Sort = 'recent' | 'name'

export type EditTarget = { kind: 'record'; id: string } | { kind: 'draft'; from: string }

interface Props {
  onBack: () => void
  onEdit: (target: EditTarget) => void
  onManageFavourites: () => void
}


export function Library({ onBack, onEdit, onManageFavourites }: Props) {
  const all = (useResource(profiles).value ?? []) as ProfileRecordFull[]
  const slots = useResource(favourites).value ?? []
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const activeId = activeProfileId(wf?.profile, all, slots)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ProfileRecord | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const visible = all.filter((r) => r.visibility === 'visible')
  const counts = {
    all: visible.length,
    favourites: slots.filter(Boolean).length,
    builtin: visible.filter((r) => r.isDefault).length,
    mine: visible.filter((r) => !r.isDefault).length,
    hidden: all.filter((r) => r.visibility === 'hidden').length,
  }
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = filter === 'hidden' ? all.filter((r) => r.visibility === 'hidden')
      : filter === 'favourites' ? slots.map((id) => all.find((r) => r.id === id)).filter((r): r is ProfileRecordFull => !!r)
      : visible.filter((r) => filter === 'all' || (filter === 'builtin' ? r.isDefault : !r.isDefault))
    if (q) rows = rows.filter((r) => r.profile.title.toLowerCase().includes(q))
    if (filter !== 'favourites') {
      rows = [...rows].sort((a, b) => sort === 'name'
        ? a.profile.title.localeCompare(b.profile.title)
        : String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || a.profile.title.localeCompare(b.profile.title))
    }
    return rows
  }, [all, slots, query, filter, sort])

  const selected = list.find((r) => r.id === selectedId) ?? list.find((r) => r.id === activeId) ?? list[0] ?? null
  // Bring the selected row into view (e.g. the profile on the machine when the screen opens).
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected?.id, filter, query])
  const slotOf = (id: string) => slots.indexOf(id)

  const run = async (work: () => Promise<unknown>, done?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await work()
      if (done) toast(done)
    } catch (error) {
      errorToast(error)
    } finally {
      setBusy(false)
    }
  }

  const select = (r: ProfileRecord) => run(async () => { await loadProfile(r, wf); onBack() })
  // New and Edit a copy open unsaved drafts: Decaid only creates a profile once its recipe differs.
  const newProfile = () => {
    setMenuOpen(false)
    const template = all.find((r) => r.isDefault && r.profile.title === 'Default') ?? all[0]
    if (template) onEdit({ kind: 'draft', from: template.id })
  }
  const importFile = async (file: File) => {
    setMenuOpen(false)
    await run(async () => {
      const text = await file.text()
      const profile = /\.tcl$/i.test(file.name) || /^\s*(profile_title|advanced_shot)\b/.test(text) ? parseTclProfile(text) : parseProfileFile(text)
      const known = new Set(all.map((r) => r.id))
      const rec = await createProfile(profile)
      setSelectedId(rec.id)
      if (known.has(rec.id)) toast(`Already in your library as “${rec.profile.title}”`)
      else toast('Profile imported')
    })
  }

  return (
    <div className="library" data-testid="library">
      <header className="lib-header">
        <button type="button" className="icon-button ringed" aria-label="Back to home" onClick={onBack}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <h1 className="lib-title">Profiles</h1>
        <label className="lib-search">
          <DotIcon glyph="search" color="var(--taupe)" />
          <input type="search" aria-label="Search profiles" placeholder={`SEARCH ${counts.all} PROFILES`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="lib-clear" aria-label="Clear search" onClick={() => setQuery('')}><DotIcon glyph="close" color="var(--taupe)" /></button>}
        </label>
        <div className="lib-new">
          <button type="button" className="pill" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><DotIcon glyph="plus" />NEW</button>
          {menuOpen && (
            <div className="lib-menu" role="menu">
              <button type="button" role="menuitem" onClick={newProfile}>FROM THE BASIC PROFILE</button>
              <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}>IMPORT A FILE</button>
            </div>
          )}
          <input ref={fileInput} type="file" accept=".json,.tcl,application/json" hidden data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
        </div>
      </header>

      <nav className="lib-filters" aria-label="Filters">
        <div className="chips">
          {([['all', 'ALL'], ['favourites', 'FAVOURITES'], ['builtin', 'BUILT-IN'], ['mine', 'MINE'], ['hidden', 'HIDDEN']] as const).map(([f, label]) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} {counts[f]}</button>
          ))}
        </div>
        <div className="chips">
          <button type="button" className="chip bare" onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))} data-testid="sort">SORT · {sort === 'recent' ? 'RECENT' : 'NAME'}</button>
          <button type="button" className="chip manage" onClick={onManageFavourites}>
            <svg width={45} height={9} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.6} fill="var(--brown)" />)}</svg>
            MANAGE FAVOURITES
          </button>
        </div>
      </nav>

      <div className="lib-body">
        <ul className="lib-list" aria-label="Profiles" ref={listRef}>
          {list.map((r) => {
            const slot = slotOf(r.id)
            return (
              <li key={r.id}>
                <button type="button" className="lib-row" aria-current={selected?.id === r.id} aria-label={r.profile.title || 'Untitled'} onClick={() => setSelectedId(r.id)}>
                  <DotChart stages={planStages(r.profile)} mode="field" cols={11} rows={4} label="" />
                  <span className="lib-row-text">
                    <span className="lib-row-name one-line">{r.profile.title || 'Untitled'}</span>
                    <span className="label one-line">{kindLabel(r)}{r.visibility === 'hidden' ? ' · HIDDEN' : ''}{r.id === activeId ? ' · ON THE MACHINE' : ''}</span>
                  </span>
                  <span className="label lib-slot">{slot >= 0 ? `● ${slotNo(slot)}` : ''}</span>
                </button>
              </li>
            )
          })}
          {!list.length && <li className="lib-empty" data-testid="lib-empty">{query ? `Nothing matches “${query}”.` : filter === 'hidden' ? 'No hidden profiles.' : 'No profiles here yet.'}</li>}
        </ul>

        {selected && <Detail
          record={selected}
          slot={slotOf(selected.id)}
          onMachine={selected.id === activeId}
          units={prefs.units}
          busy={busy}
          onSelect={() => select(selected)}
          onEdit={() => onEdit(selected.isDefault ? { kind: 'draft', from: selected.id } : { kind: 'record', id: selected.id })}
          onDuplicate={() => onEdit({ kind: 'draft', from: selected.id })}
          onToggleHidden={() => run(() => setVisibility(selected.id, selected.visibility === 'hidden' ? 'visible' : 'hidden'), selected.visibility === 'hidden' ? 'Shown again' : 'Hidden')}
          onDelete={() => setConfirmDelete(selected)}
        />}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          eyebrow="DELETE PROFILE"
          title={`Delete “${confirmDelete.profile.title}”?`}
          body={<>Shots you’ve pulled with it stay in your history.{slotOf(confirmDelete.id) >= 0 ? ` It’s in favourite slot ${slotNo(slotOf(confirmDelete.id))}, so that slot will be left empty.` : ''}{confirmDelete.id === activeId ? ' It’s on the machine now and stays there until you choose another.' : ''}</>}
          holdLabel="HOLD TO DELETE"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { const r = confirmDelete; setConfirmDelete(null); setSelectedId(null); void run(() => deleteProfile(r.id), 'Deleted') }}
        />
      )}
    </div>
  )
}

interface DetailProps {
  record: ProfileRecord
  slot: number
  onMachine: boolean
  units: 'c' | 'f'
  busy: boolean
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onToggleHidden: () => void
  onDelete: () => void
}

function Detail({ record, slot, onMachine, units, busy, onSelect, onEdit, onDuplicate, onToggleHidden, onDelete }: DetailProps) {
  return (
    <article className="lib-detail" data-testid="lib-detail">
      <ProfileDetail record={record} slot={slot} onMachine={onMachine} units={units} />
      <div className="lib-actions">
        <div className="chips">
          <button type="button" className="chip" disabled={busy} onClick={onEdit}>{record.isDefault ? 'EDIT A COPY' : 'EDIT'}</button>
          {!record.isDefault && <button type="button" className="chip" disabled={busy} onClick={onDuplicate}>COPY</button>}
          <button type="button" className="chip" disabled={busy} onClick={onToggleHidden}>{record.visibility === 'hidden' ? 'SHOW' : 'HIDE'}</button>
          {!record.isDefault && <button type="button" className="chip" disabled={busy} onClick={onDelete}>DELETE</button>}
        </div>
        <button type="button" className="primary lib-select" disabled={busy || onMachine} onClick={onSelect}>
          <DotIcon glyph="check" color="var(--on-primary)" primary />{onMachine ? 'SELECTED' : 'SELECT'}
        </button>
      </div>
    </article>
  )
}
