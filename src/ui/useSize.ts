import { useCallback, useLayoutEffect, useState } from 'react'

// Size of an element, kept current with ResizeObserver (available in Chrome 91). Uses a callback ref, so it starts
// measuring whenever the element appears — including after an early "loading" render without it.
export function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const ref = useCallback((node: T | null) => setEl(node), [])
  useLayoutEffect(() => {
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (s.width === Math.floor(r.width) && s.height === Math.floor(r.height) ? s : { width: Math.floor(r.width), height: Math.floor(r.height) }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [ref, size, el] as const
}
