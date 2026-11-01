import { useSyncExternalStore, type ReactNode } from 'react'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 4_000) {
  const id = nextId++
  toasts = [...toasts.slice(-2), { id, text, tone, action }]
  emit()
  setTimeout(() => dismiss(id), ms)
}

// Decaid's error text can be technical (exception names, paths, codes). Show it only when it reads as a sentence.
export function plainError(error: unknown, fallback = "Decaid couldn't do that. Try again.") {
  const text = error instanceof Error ? error.message : String(error)
  const technical = /exception|error\(|[{}_<>]|\/api\/|\b(GET|PUT|POST|DELETE)\b|\b[45]\d\d\b|^\w*error\b|unauthori[sz]ed|forbidden|timeout|null|undefined/i.test(text) || text.length > 140 || !text.trim()
  if (technical) console.warn('[mono]', text)
  return technical ? fallback : text
}

export function errorToast(error: unknown, fallback?: string) {
  toast(plainError(error, fallback), 'error', undefined, 6_000)
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function Toasts({ children }: { children?: ReactNode }) {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => toasts)
  return (
    <div aria-live="polite" style={{ position: 'fixed', left: 0, right: 0, top: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', zIndex: 50 }}>
      {children}
      {list.map((t) => (
        <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="toast" data-tone={t.tone}>
          <span>{t.text}</span>
          {t.action && (
            <button type="button" className="toast-action" onClick={() => { t.action?.run(); dismiss(t.id) }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}
