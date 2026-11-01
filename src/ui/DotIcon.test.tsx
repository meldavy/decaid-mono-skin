import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DotIcon, ICON_PITCH, PRIMARY_ICON_PITCH } from './DotIcon'
import { GLYPHS, type GlyphName } from './glyphs'

describe('iconography on the grid', () => {
  it('every icon uses the same 3 px dots — 3 × 3 per 9 px grid cell — and is 27 px (3 cells)', () => {
    expect(9 % ICON_PITCH).toBe(0)
    for (const glyph of Object.keys(GLYPHS) as GlyphName[]) {
      const { container, unmount } = render(<DotIcon glyph={glyph} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('width'), glyph).toBe('27')
      for (const c of container.querySelectorAll('circle')) {
        expect((Number(c.getAttribute('cx')) - ICON_PITCH / 2) % ICON_PITCH, glyph).toBe(0)
        expect(c.getAttribute('r'), glyph).toBe(String(ICON_PITCH * 0.36))
      }
      unmount()
    }
  })

  it('the running modals draw their animated icons large, like the primary tile', () => {
    const { container } = render(<DotIcon glyph="steam" animate />)
    expect(container.querySelector('svg')!.getAttribute('width')).toBe(String(9 * PRIMARY_ICON_PITCH))
  })
})

describe('primary action icons', () => {
  it('use 4.5 px dots (2 × 2 per grid cell) on the same 9 × 9 designs', () => {
    expect(9 % PRIMARY_ICON_PITCH).toBe(0)
    for (const glyph of ['brew', 'stop', 'check'] as GlyphName[]) {
      const { container, unmount } = render(<DotIcon glyph={glyph} primary />)
      expect(container.querySelector('svg')!.getAttribute('width'), glyph).toBe(String(9 * PRIMARY_ICON_PITCH))
      for (const c of container.querySelectorAll('circle')) expect((Number(c.getAttribute('cx')) - PRIMARY_ICON_PITCH / 2) % PRIMARY_ICON_PITCH).toBe(0)
      unmount()
    }
  })
})
