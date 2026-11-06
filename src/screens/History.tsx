import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { beanLine, groupByDay, summarize, type ShotSummary, type StoredShot } from '../domain/history'
import { planStages, type Profile } from '../domain/profile'
import { fetchFull, fetchPage, uploadToVisualizer, VISUALIZER } from '../state/history'
import { prefsResource, withDefaults } from '../state/prefs'
import { useResource } from '../state/resource'
import { plugins } from '../state/settings'
import { enjoymentToStars, starsToEnjoyment, stopReasonLabel, updateShot } from '../state/shots'
import { saveWorkflow } from '../state/workflow'
import { DISPLAY_PITCH, DotChart } from '../ui/DotChart'
import { chartCols } from '../ui/fit'
import { useShort } from '../ui/useShort'
import { useSize } from '../ui/useSize'
import { DotIcon } from '../ui/DotIcon'
import { clock, fixed, NONE } from '../ui/format'
import { errorToast, toast } from '../ui/toasts'
import { NotesSheet } from './NotesSheet'
import './library.css'
import '../sheets/sheet.css' // the rating pips are the Rate sheet's
import './history.css'

// History: shots grouped by day on the left, the chosen shot on the right.
export function History({ onBack, onBrewAgain }: { onBack: () => void; onBrewAgain: () => void }) {
  const prefs = withDefaults(useResource(prefsResource).value)
  const plugs = useResource(plugins).value ?? []
  const canUpload = plugs.some((p) => p.id === VISUALIZER && p.loaded === true)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [list, setList] = useState<StoredShot[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [allTotal, setAllTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState<Map<string, StoredShot>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const generation = useRef(0)

  // Search is sent to Decaid a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const loadFull = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !full.has(id))
    if (!missing.length) return
    const records = await fetchFull(missing)
    setFull((prev) => { const next = new Map(prev); for (const r of records) next.set(r.id, r); return next })
  }, [full])

  const loadMore = useCallback(async (reset = false) => {
    const gen = reset ? ++generation.current : generation.current
    setLoading(true)
    setFailed(false)
    try {
      const page = await fetchPage(reset ? 0 : list.length, search)
      if (gen !== generation.current) return
      setList((prev) => (reset ? page.items : [...prev, ...page.items.filter((s) => !prev.some((p) => p.id === s.id))]))
      setTotal(page.total)
      if (!search.trim()) setAllTotal(page.total)
      if (reset) setSelected((sel) => (sel && page.items.some((s) => s.id === sel) ? sel : page.items[0]?.id ?? null))
      void loadFull(page.items.map((s) => s.id)).catch(() => undefined)
    } catch {
      if (gen === generation.current) setFailed(true)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [list.length, search, loadFull])

  useEffect(() => { void loadMore(true) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Progressive loading: the next page when the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null)
  const more = total !== null && list.length < total
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more || loading) return
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore() })
    io.observe(el)
    return () => io.disconnect()
  }, [more, loading, loadMore])

  const now = new Date()
  const groups = useMemo(() => groupByDay(list, now), [list]) // eslint-disable-line react-hooks/exhaustive-deps
  const shot = selected ? full.get(selected) ?? list.find((s) => s.id === selected) ?? null : null

  const refresh = async (id: string) => {
    const [record] = await fetchFull([id])
    if (record) {
      setFull((prev) => new Map(prev).set(id, record))
      setList((prev) => prev.map((s) => (s.id === id ? { ...s, annotations: record.annotations, workflow: record.workflow } : s)))
    }
  }

  const rate = async (stars: number) => {
    if (!shot) return
    const current = enjoymentToStars(shot.annotations?.enjoyment)
    const next = current === stars ? 0 : stars // tapping the current rating clears it
    try {
      await updateShot(shot.id, { annotations: { enjoyment: starsToEnjoyment(next) } })
      await refresh(shot.id)
    } catch (error) { errorToast(error, "Couldn't save the rating.") }
  }

  const brewAgain = async () => {
    if (!shot?.workflow?.profile) return
    const c = shot.workflow.context
    try {
      await saveWorkflow({ profile: shot.workflow.profile as Profile, context: { ...(c?.targetDoseWeight ? { targetDoseWeight: c.targetDoseWeight } : {}), ...(c?.targetYield ? { targetYield: c.targetYield } : {}) } })
      onBrewAgain()
    } catch (error) { errorToast(error, "Couldn't load that shot's recipe.") }
  }

  const upload = async () => {
    if (!shot) return
    setUploading(true)
    try {
      await uploadToVisualizer(shot.id)
      toast('Uploaded to Visualizer')
    } catch (error) {
      errorToast(error, "Couldn't upload to Visualizer. Check the plugin's sign-in in Decaid.")
    } finally { setUploading(false) }
  }

  const placeholder = allTotal ? `SEARCH ${allTotal} SHOTS · PROFILE, BEAN, NOTE` : 'SEARCH SHOTS · PROFILE, BEAN, NOTE'
  return (
    <div className="library history" data-testid="history">
      <header className="lib-header">
        <button type="button" className="icon-button ringed" aria-label="Back to home" onClick={onBack}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <h1 className="lib-title">History</h1>
        <label className="lib-search">
          <DotIcon glyph="search" color="var(--taupe)" />
          <input type="search" aria-label="Search shots" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="lib-clear" aria-label="Clear search" onClick={() => setQuery('')}><DotIcon glyph="close" color="var(--taupe)" /></button>}
        </label>
      </header>
      <div className="lib-body">
        <div className="lib-list hist-list" data-testid="shot-list">
          {groups.map((g) => (
            <div key={g.label + g.shots[0].id} className="hist-day" role="group" aria-label={g.label}>
              <span className="label hist-day-label">{g.label}</span>
              {g.shots.map((s) => <ShotRow key={s.id} shot={s} record={full.get(s.id)} selected={s.id === selected} clockFormat={prefs.clock} onClick={() => setSelected(s.id)} />)}
            </div>
          ))}
          {!list.length && !loading && !failed && <p className="lib-empty" data-testid="history-empty">{search.trim() ? `No shots match “${search.trim()}”.` : 'No shots yet.'}</p>}
          {failed && <p className="lib-empty" role="alert">Couldn't load shots. <button type="button" className="chip" onClick={() => void loadMore(!list.length)}>TRY AGAIN</button></p>}
          {more && <div ref={sentinel} className="label hist-more" data-testid="history-more">{loading ? 'LOADING…' : ''}</div>}
          {loading && !list.length && <span className="label hist-more">LOADING…</span>}
        </div>
        {shot ? (
          <ShotDetail
            key={shot.id}
            shot={shot}
            summary={full.has(shot.id) ? summarize(full.get(shot.id)!) : null}
            clockFormat={prefs.clock}
            canUpload={canUpload}
            uploading={uploading}
            onRate={rate}
            onNote={() => setNotesFor(shot.id)}
            onUpload={upload}
            onBrewAgain={brewAgain}
          />
        ) : <section className="lib-detail hist-detail-empty" aria-label="Shot" />}
      </div>
      {notesFor && <NotesSheet shotId={notesFor} onClose={() => { const id = notesFor; setNotesFor(null); void refresh(id) }} />}
    </div>
  )
}

function resultText(s: ShotSummary | null) {
  if (!s) return ''
  return [s.yield != null ? `${s.yield.toFixed(1)}G` : null, s.duration != null ? `${Math.round(s.duration)}S` : null].filter(Boolean).join(' · ')
}

function Dots({ stars, size, label }: { stars: number; size: number; label: string }) {
  return (
    <span className="hist-rate" aria-label={label} role="img">
      {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ width: size, height: size, background: i <= stars ? 'var(--brown)' : 'var(--line)' }} />)}
    </span>
  )
}

function ShotRow({ shot, record, selected, clockFormat, onClick }: { shot: StoredShot; record?: StoredShot; selected: boolean; clockFormat: '12' | '24'; onClick: () => void }) {
  const summary = record ? summarize(record) : null
  const stars = enjoymentToStars(shot.annotations?.enjoyment)
  const title = shot.workflow?.profile?.title || 'Untitled'
  const stages = useMemo(() => (shot.workflow?.profile?.steps ? planStages(shot.workflow.profile as Profile) : []), [shot.workflow?.profile])
  return (
    <button type="button" className="lib-row hist-row" aria-current={selected} onClick={onClick} aria-label={`${title}, ${clock(new Date(shot.timestamp), clockFormat)}`} data-testid="shot-row">
      <span className="hist-mini"><DotChart stages={stages} samples={summary?.samples} mode="field" cols={10} rows={4} label="" /></span>
      <span className="lib-row-text">
        <span className="lib-row-name one-line">{title}</span>
        <span className="hist-row-meta">
          <span className="label">{clock(new Date(shot.timestamp), clockFormat)}</span>
          <span className="hist-result" data-testid="shot-result">{resultText(summary)}</span>
        </span>
      </span>
      <Dots stars={stars} size={6} label={stars ? `Rated ${stars} of 5` : 'Not rated'} />
    </button>
  )
}

interface DetailProps {
  shot: StoredShot
  summary: ShotSummary | null
  clockFormat: '12' | '24'
  canUpload: boolean
  uploading: boolean
  onRate: (stars: number) => void
  onNote: () => void
  onUpload: () => void
  onBrewAgain: () => void
}

function ShotDetail({ shot, summary, clockFormat, canUpload, uploading, onRate, onNote, onUpload, onBrewAgain }: DetailProps) {
  const when = new Date(shot.timestamp)
  const day = groupByDay([shot], new Date())[0]?.label ?? ''
  const title = shot.workflow?.profile?.title || 'Untitled'
  const stars = enjoymentToStars(shot.annotations?.enjoyment)
  const note = shot.annotations?.espressoNotes?.trim()
  const grind = shot.workflow?.context?.grinderSetting?.trim()
  const stages = useMemo(() => (shot.workflow?.profile?.steps ? planStages(shot.workflow.profile as Profile) : []), [shot.workflow?.profile])
  const sub = beanLine(shot, summary?.dose ?? null)
  const [chartRef, { width: chartWidth }] = useSize<HTMLDivElement>()
  const short = useShort()
  return (
    <section className="lib-detail" aria-label={title} data-testid="shot-detail">
      <div className="lib-detail-scroll">
        <div className="hist-head">
          <div className="lib-detail-head">
            <span className="label" data-testid="shot-when">{`${day} · ${clock(when, clockFormat)} · ${stopReasonLabel(shot.stopReason)}`}</span>
            <span className="lib-detail-title" title={title}>{title}</span>
            {sub && <span className="hist-sub">{sub}</span>}
          </div>
        </div>
        <div className="lib-detail-chart" ref={chartRef}>
          <DotChart stages={stages} samples={summary?.samples ?? []} cols={chartCols(chartWidth, DISPLAY_PITCH)} rows={short ? 9 : 13} axis rail label={`${title}: pressure and flow`} />
        </div>
        <div className="lib-stats" data-testid="shot-stats">
          <Stat label="TIME S" value={fixed(summary?.duration, 1)} />
          <Stat label="WEIGHT G" value={fixed(summary?.yield, 1)} />
          <Stat label="RATIO" value={summary?.ratio ? `1:${summary.ratio.toFixed(1)}` : NONE} />
          <Stat label="PEAK BAR" value={fixed(summary?.peakPressure, 1)} />
        </div>
        {/* Rating then note, each under a divider; the pips are the Rate sheet's. */}
        <div className="hist-rating">
          <span className="label">RATING</span>
          <div className="hist-pips" role="group" aria-label={stars ? `Rated ${stars} of 5` : 'Not rated'}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" className="rate" aria-label={`Rate ${i} of 5`} aria-pressed={i <= stars} onClick={() => onRate(i)}>
                <span style={{ background: i <= stars ? 'var(--brown)' : 'transparent' }} />
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="hist-note" onClick={onNote} data-testid="shot-note">
          <span className="label">{grind ? `NOTE · GRIND ${grind.toUpperCase()}` : 'NOTE'}</span>
          <span className={note ? 'hist-note-text' : 'hist-note-text empty'}>{note || 'Add a note'}</span>
        </button>
      </div>
      <div className="lib-actions">
        <div className="chips">
          {canUpload && <button type="button" className="pill" disabled={uploading} onClick={onUpload}>{uploading ? 'UPLOADING…' : 'UPLOAD'}</button>}
        </div>
        <button type="button" className="primary lib-select" disabled={!shot.workflow?.profile} onClick={onBrewAgain}><DotIcon glyph="brew" color="var(--on-primary)" primary />BREW AGAIN</button>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><span className="label">{label}</span><span className="lib-stat">{value}</span></div>
}

