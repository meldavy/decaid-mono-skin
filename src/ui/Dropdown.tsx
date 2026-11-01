import { useEffect, useState, type ReactNode } from 'react'

// A button that opens a short list under it; choosing closes it. Tapping outside or Esc closes it unchanged.
export function Dropdown<T extends string>({ label, value, options, onChange, className, testId, children }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; className: string; testId?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  return (
    <div className="dropdown">
      <button type="button" className={className} data-testid={testId} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{children}</button>
      {open && (
        <>
          <div className="dropdown-catcher" onClick={() => setOpen(false)} />
          <div className="dropdown-list" role="listbox" aria-label={label}>
            {options.map(([v, text]) => (
              <button key={v} type="button" role="option" aria-selected={v === value} className="dropdown-option" onClick={() => { setOpen(false); if (v !== value) onChange(v) }}>
                <span className="one-line">{text}</span>
                <span className="radio-mark" aria-hidden />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
