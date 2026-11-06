import { useEffect, useState } from 'react'
import type { FieldSpec } from '../domain/editing'
import { DotIcon } from './DotIcon'
import { fixed } from './format'
import { Ruler, useHoldRepeat } from './Ruler'
import '../sheets/sheet.css'

// One number: ruler, − / +, Off when the field can be switched off. `choice` adds a toggle that is part of the
// value (e.g. above / below); onDone gets the chosen option too.
export function ValueSheet({ title, spec, value, choice, onCancel, onDone }: { title: string; spec: FieldSpec; value: number | null; choice?: { label: string; options: [string, string][]; value: string }; onCancel: () => void; onDone: (v: number | null, choice?: string) => void }) {
  const [v, setV] = useState<number | null>(value)
  const [c, setC] = useState(choice?.value)
  const shown = v ?? Math.max(spec.min, Math.min(spec.max, spec.min))
  const clampStep = (x: number) => Number(Math.min(spec.max, Math.max(spec.min, x)).toFixed(spec.decimals))
  const minus = useHoldRepeat(() => setV((x) => clampStep((x ?? spec.min) - spec.step)))
  const plus = useHoldRepeat(() => setV((x) => clampStep((x ?? spec.min - spec.step) + spec.step)))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} data-testid="scrim" />
      <section className="sheet ed-value-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle"><span /></div>
        <div className="sheet-focus">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span className="label one-line">{title}</span>
            <span className="ed-value-big"><span data-testid="value-sheet-value">{v === null ? 'OFF' : fixed(v, spec.decimals)}</span>{v !== null && <span className="label">{spec.unit}</span>}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
            {choice && (
              <div role="group" aria-label={choice.label} className="ed-seg sheet-choice">
                {choice.options.map(([o, text]) => <button key={o} type="button" aria-pressed={c === o} onClick={() => setC(o)}>{text}</button>)}
              </div>
            )}
            {spec.offable && <button type="button" className="chip" aria-pressed={v === null} onClick={() => setV(null)}>OFF</button>}
            <button type="button" className="round" aria-label="Decrease" {...minus}>−</button>
            <button type="button" className="round" aria-label="Increase" {...plus}>+</button>
          </div>
        </div>
        <Ruler value={shown} min={spec.min} max={spec.max} step={spec.step} decimals={spec.decimals} label={`${title} ruler`} onChange={(x) => setV(x)} />
        <div className="sheet-footer">
          <span />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" onClick={() => onDone(v, c)}><DotIcon glyph="check" color="var(--on-primary)" />DONE</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// `secret`: what's typed is hidden (passwords). `numeric`: the number keyboard.
export function TextSheet({ label, value, multiline, onCancel, onDone, maxLength, secret = false, numeric = false }: { label: string; value: string; multiline: boolean; onCancel: () => void; onDone: (v: string) => void; maxLength?: number; secret?: boolean; numeric?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} data-testid="scrim" />
      <section className="sheet ed-text-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet-handle"><span /></div>
        <label className="notes-field">
          <span className="label">{label}</span>
          {multiline
            ? <textarea value={v} maxLength={4000} onChange={(e) => setV(e.target.value)} data-testid="text-input" autoFocus />
            : <input className="ed-text-input" type={secret ? 'password' : 'text'} autoComplete={secret ? 'off' : undefined} inputMode={numeric ? 'decimal' : undefined} value={v} maxLength={maxLength ?? 80} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onDone(v.trim())} data-testid="text-input" autoFocus />}
        </label>
        <div className="sheet-footer">
          <span className="label">{multiline ? `${v.length} / 4000` : `${v.length} / ${maxLength ?? 80}`}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" onClick={() => onDone(multiline ? v : v.trim())}><DotIcon glyph="check" color="var(--on-primary)" />DONE</button>
          </div>
        </div>
      </section>
    </div>
  )
}
