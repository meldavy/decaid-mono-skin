import { useEffect } from 'react'
import { DotIcon } from './DotIcon'

// Leaving with unsaved changes. Lists what changed; Discard / Keep editing / Save.
export interface Change { what: string; from: string; to: string }

interface Props {
  context: string // e.g. "UNSAVED CHANGES · FAVOURITES"
  changes: Change[]
  onDiscard: () => void
  onKeep: () => void
  onSave: () => void
}

export function UnsavedDialog({ context, changes, onDiscard, onKeep, onSave }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKeep])
  const shown = changes.slice(0, 4)
  return (
    <div className="confirm-layer">
      <div className="scrim" onClick={onKeep} />
      <section className="confirm unsaved" role="alertdialog" aria-modal="true" aria-label="Leave without saving?">
        <span className="label one-line">{context}</span>
        <span className="confirm-title">Leave without saving?</span>
        <div className="unsaved-list" data-testid="unsaved-list">
          {shown.map((c, i) => (
            <div key={i} className="unsaved-row">
              <span className="one-line">{c.what}</span>
              <span className="unsaved-change label"><span className="one-line">{c.from}</span>→<span className="one-line" style={{ color: 'var(--ink)' }}>{c.to}</span></span>
            </div>
          ))}
          {changes.length > shown.length && <div className="unsaved-row label">+{changes.length - shown.length} MORE</div>}
        </div>
        <div className="confirm-actions">
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onDiscard}>DISCARD</button>
            <button type="button" className="quiet-button" onClick={onKeep}>KEEP EDITING</button>
          </div>
          <button type="button" className="save" onClick={onSave}><DotIcon glyph="check" color="var(--on-primary)" />SAVE</button>
        </div>
      </section>
    </div>
  )
}
