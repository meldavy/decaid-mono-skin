import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { enjoymentToStars, getShot, starsToEnjoyment, updateShot } from '../state/shots'
import { DotIcon } from '../ui/DotIcon'
import { CoffeeSheet, type CoffeeChoice } from '../sheets/CoffeeSheet'
import { coffeeContext, grinderContext } from '../state/coffee'
import { toast } from '../ui/toasts'
import '../sheets/sheet.css'

export const NOTE_LIMIT = 2_000

// Notes, and the optional coffee, grinder and grind, for one shot; with `rating`, its rating too. Saves only what
// changed. onClose gets the result after a save, nothing when cancelled. Coffee and grinder are picked from Beans
// (the same picker as Home's); a coffee typed on an older shot stays until another is picked.
export function NotesSheet({ shotId, rating = false, onClose }: { shotId: string; rating?: boolean; onClose: (result?: { hasNote: boolean; stars: number }) => void }) {
  const [loaded, setLoaded] = useState<{ notes: string; grind: string; coffee: string; roaster: string; bagId: string; grinderId: string; grinderModel: string; stars: number } | null>(null)
  const [picked, setPicked] = useState<CoffeeChoice | null>(null) // null: unchanged
  const [picking, setPicking] = useState(false)
  const [stars, setStars] = useState(0)
  const [notes, setNotes] = useState('')
  const [grind, setGrind] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const saving = useRef(false)

  useEffect(() => {
    getShot(shotId).then((s) => {
      const c = s.workflow?.context
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const initial = { notes: s.annotations?.espressoNotes ?? '', grind: String(c?.grinderSetting ?? ''), coffee: str(c?.coffeeName), roaster: str(c?.coffeeRoaster), bagId: str(c?.beanBatchId), grinderId: str(c?.grinderId), grinderModel: str(c?.grinderModel), stars: enjoymentToStars(s.annotations?.enjoyment) }
      setLoaded(initial)
      setStars(initial.stars)
      setNotes(initial.notes)
      setGrind(initial.grind)
    }, () => setLoaded({ notes: '', grind: '', coffee: '', roaster: '', bagId: '', grinderId: '', grinderModel: '', stars: 0 }))
  }, [shotId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !picking && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, picking])

  const save = async () => {
    if (saving.current || !loaded) return
    const patch: Parameters<typeof updateShot>[1] = {}
    if (notes !== loaded.notes) patch.annotations = { espressoNotes: notes.trim() ? notes : null }
    if (rating && stars !== loaded.stars) patch.annotations = { ...patch.annotations, enjoyment: starsToEnjoyment(stars) }
    const context: Record<string, string | null> = {}
    if (grind.trim() !== loaded.grind) context.grinderSetting = grind.trim() || null
    if (picked) Object.assign(context, coffeeContext(picked.bean, picked.bag), grinderContext(picked.grinder))
    if (Object.keys(context).length) patch.workflow = { context }
    if (!patch.annotations && !patch.workflow) return onClose()
    saving.current = true
    setStatus('saving')
    try {
      await updateShot(shotId, patch)
      toast('Saved')
      onClose({ hasNote: !!notes.trim(), stars })
    } catch {
      setStatus('error')
    } finally {
      saving.current = false
    }
  }

  const coffeeLine = picked
    ? [[picked.bean?.roaster, picked.bean?.name].filter(Boolean).join(', '), picked.grinder?.model].filter(Boolean).join(' · ')
    : loaded ? [[loaded.roaster, loaded.coffee].filter(Boolean).join(', '), loaded.grinderModel].filter(Boolean).join(' · ') : ''

  const swipe = useRef<{ y: number; id: number } | null>(null)
  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => { swipe.current = { y: e.clientY, id: e.pointerId }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onHandleUp = (e: PointerEvent) => { if (swipe.current?.id === e.pointerId && e.clientY - swipe.current.y > 80) onClose(); swipe.current = null }

  return (
    <div className="sheet-layer">
      <div className="scrim" data-testid="scrim" onClick={() => onClose()} />
      <section className="sheet notes-sheet" role="dialog" aria-modal="true" aria-label="Shot notes">
        <div className="sheet-handle" onPointerDown={onHandleDown} onPointerUp={onHandleUp} data-testid="sheet-handle"><span /></div>
        {rating && (
          <div className="notes-rating" role="group" aria-label={`Rating, ${stars} of 5`}>
            <span className="label">RATING</span>
            {/* Tapping the current rating clears it. */}
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className="rate" aria-label={`Rate ${n} of 5`} aria-pressed={n <= stars} disabled={!loaded} onClick={() => setStars(n === stars ? 0 : n)}>
                <span style={{ background: n <= stars ? 'var(--brown)' : 'transparent' }} />
              </button>
            ))}
          </div>
        )}
        <label className="notes-field">
          <span className="label">NOTES</span>
          <textarea value={notes} maxLength={NOTE_LIMIT} disabled={!loaded} onChange={(e) => setNotes(e.target.value)} placeholder="How did it taste?" data-testid="notes-input" />
          <span className="label notes-count">{notes.length} / {NOTE_LIMIT}</span>
        </label>
        <div className="notes-row">
          <div className="notes-grind notes-wide">
            <span className="label">COFFEE · GRINDER</span>
            <button type="button" className="notes-pick" disabled={!loaded} onClick={() => setPicking(true)} data-testid="coffee-pick">
              <span className={coffeeLine ? 'one-line' : 'one-line empty'}>{coffeeLine || 'Choose from your beans'}</span>
            </button>
          </div>
          <label className="notes-grind">
            <span className="label">GRIND · OPTIONAL</span>
            <input value={grind} maxLength={24} disabled={!loaded} onChange={(e) => setGrind(e.target.value)} placeholder="e.g. 2.5" data-testid="grind-input" />
          </label>
        </div>
        <div className="sheet-footer">
          <span className="label" role={status === 'error' ? 'alert' : undefined} data-testid="notes-status">
            {status === 'saving' ? 'SAVING…' : status === 'error' ? "COULDN'T SAVE — YOUR TEXT IS STILL HERE" : ''}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={() => onClose()}>CANCEL</button>
            <button type="button" className="save" onClick={save} disabled={status === 'saving' || !loaded}><DotIcon glyph="check" color="var(--on-primary)" />SAVE</button>
          </div>
        </div>
      </section>
      {picking && loaded && (
        <CoffeeSheet title="Coffee and grinder for this shot"
          initial={picked ? { bagId: picked.bag?.id, coffee: picked.bean?.name, roaster: picked.bean?.roaster, grinderId: picked.grinder?.id } : { bagId: loaded.bagId, coffee: loaded.coffee, roaster: loaded.roaster, grinderId: loaded.grinderId }}
          onCancel={() => setPicking(false)}
          onDone={(c) => { setPicking(false); setPicked(c) }} />
      )}
    </div>
  )
}
