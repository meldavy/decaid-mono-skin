import { useEffect, useState, type ReactNode } from 'react'
import { DotIcon } from '../ui/DotIcon'
import './sheet.css'
import './coffee.css'

// A form in a bottom sheet: labelled fields on a grid, Cancel / Save. Text only — each caller turns the strings
// into its record and returns a message when something is missing or wrong (shown in the footer, nothing saved).

export interface Field {
  key: string
  label: string
  kind?: 'text' | 'number' | 'date' | 'notes'
  span?: 1 | 2 | 3
  placeholder?: string
  presets?: string[] // chips under the field that fill it in
  max?: number
}

interface Props {
  title: string
  fields: Field[]
  initial: Record<string, string>
  extra?: (values: Record<string, string>, set: (key: string, v: string) => void) => ReactNode // e.g. a toggle in the footer
  onCancel: () => void
  onSave: (values: Record<string, string>) => Promise<string | undefined> // a problem to show, or nothing
}

export function FormSheet({ title, fields, initial, extra, onCancel, onSave }: Props) {
  const [values, setValues] = useState(initial)
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key: string, v: string) => { setValues((x) => ({ ...x, [key]: v })); setProblem('') }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const message = await onSave(values)
      if (message) setProblem(message)
    } catch (error) {
      setProblem(error instanceof Error && error.message ? error.message : "Couldn't save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} data-testid="scrim" />
      <section className="sheet form-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle"><span /></div>
        <span className="label">{title.toUpperCase()}</span>
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.key} className={`form-field span-${f.span ?? 1}`}>
              <span className="label">{f.label}</span>
              {f.kind === 'notes'
                ? <textarea value={values[f.key] ?? ''} maxLength={f.max ?? 2000} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} data-testid={`field-${f.key}`} />
                : <input type={f.kind === 'date' ? 'date' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} value={values[f.key] ?? ''} maxLength={f.max ?? 80} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} data-testid={`field-${f.key}`} />}
              {f.presets && (
                <span className="form-presets">
                  {f.presets.map((p) => <button key={p} type="button" className="chip" aria-pressed={(values[f.key] ?? '').toLowerCase() === p.toLowerCase()} onClick={() => set(f.key, p)}>{p.toUpperCase()}</button>)}
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="sheet-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            {extra?.(values, set)}
            <span className="label form-problem" role={problem ? 'alert' : undefined} data-testid="form-problem">{saving ? 'SAVING…' : problem.toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" disabled={saving} onClick={() => void save()}><DotIcon glyph="check" color="var(--on-primary)" />SAVE</button>
          </div>
        </div>
      </section>
    </div>
  )
}
