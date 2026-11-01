import { useEffect, useState } from 'react'
import { ANIMATIONS, GLYPHS, litDots, type GlyphName } from './glyphs'

// Two icon dot spacings, both on the 9 px grid: 3 px (3 × 3 per cell) for everyday icons, and 4.5 px (2 × 2 per cell)
// for the large ones — the primary action tile (Brew, Stop, Done), Stop in the running modals, and the modals'
// animated icons — where 3 px dots would run together. Same 9 × 9 designs either way.
export const ICON_PITCH = 3
export const PRIMARY_ICON_PITCH = 4.5

interface Props {
  glyph: GlyphName
  color?: string
  animate?: boolean // only steam / water / flush have frames; animated icons are drawn large
  label?: string
  primary?: boolean // large: the primary tile, and Stop in the running modals
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function DotIcon({ glyph, color = 'currentColor', animate = false, label, primary = false }: Props) {
  const frames = animate && glyph in ANIMATIONS ? ANIMATIONS[glyph as keyof typeof ANIMATIONS] : null
  const large = primary || !!frames
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!frames || reducedMotion()) return
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 500)
    return () => clearInterval(timer)
  }, [frames])

  const rows = frames ? frames[frame] : GLYPHS[glyph]
  const pitch = large ? PRIMARY_ICON_PITCH : ICON_PITCH
  const size = rows.length * pitch
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-frame={frames ? frame : undefined}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {litDots(rows).map(({ c, r }) => (
        <circle key={`${c}-${r}`} cx={c * pitch + pitch / 2} cy={r * pitch + pitch / 2} r={pitch * 0.36} fill={color} />
      ))}
    </svg>
  )
}
