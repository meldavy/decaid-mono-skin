import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { enjoymentToStars, getShot, starsToEnjoyment, updateShot } from '../state/shots'
import { DotIcon } from '../ui/DotIcon'
import { toast } from '../ui/toasts'
import '../sheets/sheet.css'

export const NOTE_LIMIT = 2_000

// Notes, and the optional coffee, roaster and grind, for one shot; with `rating`, its rating too. Saves only what
// changed. onClose gets the result after a save, nothing when cancelled.
export function NotesSheet({ shotId, rating = false, onClose }: { shotId: string; rating?: boolean; onClose: (result?: { hasNote: boolean; stars: number }) => void }) {
  const [loaded, setLoaded] = useState<{ notes: string; grind: string; coffee: string; roaster: string; stars: number } | null>(null)
  const [stars, setStars] = useState(0)
  const [notes, setNotes] = useState('')
  const [grind, setGrind] = useState('')
  const [coffee, setCoffee] = useState('')
  const [roaster, setRoaster] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const saving = useRef(false)

  useEffect(() => {
    getShot(shotId).then((s) => {
      const c = s.workflow?.context
      const initial = { notes: s.annotations?.espressoNotes ?? '', grind: String(c?.grinderSetting ?? ''), coffee: String(c?.coffeeName ?? ''), roaster: String(c?.coffeeRoaster ?? ''), stars: enjoymentToStars(s.annotations?.enjoyment) }
      setLoaded(initial)
      setStars(initial.stars)
      setNotes(initial.notes)
      setGrind(initial.grind)
      setCoffee(initial.coffee)
      setRoaster(initial.roaster)
    }, () => setLoaded({ notes: '', grind: '', coffee: '', roaster: '', stars: 0 }))
  }, [shotId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (saving.current || !loaded) return
    const patch: Parameters<typeof updateShot>[1] = {}
    if (notes !== loaded.notes) patch.annotations = { espressoNotes: notes.trim() ? notes : null }
    if (rating && stars !== loaded.stars) patch.annotations = { ...patch.annotations, enjoyment: starsToEnjoyment(stars) }
    const context: Record<string, string | null> = {}
    if (grind.trim() !== loaded.grind) context.grinderSetting = grind.trim() || null
    if (coffee.trim() !== loaded.coffee) context.coffeeName = coffee.trim() || null
    if (roaster.trim() !== loaded.roaster) context.coffeeRoaster = roaster.trim() || null
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
          <label className="notes-grind notes-wide">
            <span className="label">ROASTER · OPTIONAL</span>
            <input value={roaster} maxLength={60} disabled={!loaded} onChange={(e) => setRoaster(e.target.value)} placeholder="e.g. The Big Roasters" data-testid="roaster-input" />
          </label>
          <label className="notes-grind notes-wide">
            <span className="label">COFFEE · OPTIONAL</span>
            <input value={coffee} maxLength={60} disabled={!loaded} onChange={(e) => setCoffee(e.target.value)} placeholder="e.g. Brasilia" data-testid="coffee-input" />
          </label>
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
            <button type="button" className="save" onClick={save} disabled={status === 'saving' || !loaded}><DotIcon glyph="check" color="#fff" />SAVE</button>
          </div>
        </div>
      </section>
    </div>
  )
}
