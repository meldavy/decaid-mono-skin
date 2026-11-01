import { useEffect, type ReactNode } from 'react'
import { HoldButton } from './HoldButton'

// A question to the person — a white card. Destructive confirmations use hold-to-confirm.
interface Props {
  eyebrow: string
  title: string
  body?: ReactNode
  keepLabel?: string
  holdLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ eyebrow, title, body, keepLabel = 'KEEP IT', holdLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="confirm-layer">
      <div className="scrim" onClick={onCancel} data-testid="confirm-scrim" />
      <section className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <span className="label">{eyebrow}</span>
        <span className="confirm-title">{title}</span>
        {body && <span className="confirm-body">{body}</span>}
        <div className="confirm-actions">
          <button type="button" className="quiet-button" onClick={onCancel}>{keepLabel}</button>
          <HoldButton label={holdLabel} onConfirm={onConfirm} />
        </div>
      </section>
    </div>
  )
}
