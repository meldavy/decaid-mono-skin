import { describe, expect, it } from 'vitest'
import { ANIMATIONS, GLYPHS } from './glyphs'

const square = (rows: readonly string[]) => rows.length === 9 && rows.every((r) => /^[.#]{9}$/.test(r))

describe('glyphs', () => {
  it('are all 9×9', () => {
    for (const [name, rows] of Object.entries(GLYPHS)) expect(square(rows), name).toBe(true)
  })

  it('RUN-10 animation frames are 9×9 and each frame differs from the next', () => {
    for (const [name, frames] of Object.entries(ANIMATIONS)) {
      expect(frames.length, name).toBe(4)
      frames.forEach((f, i) => {
        expect(square(f), `${name} frame ${i}`).toBe(true)
        expect(f.join(), `${name} frame ${i}`).not.toBe(frames[(i + 1) % frames.length].join())
      })
    }
  })

  it('steam and flush frames are true shifts (steam rises, flush falls)', () => {
    const s = ANIMATIONS.steam
    expect(s[1].slice(0, 5)).toEqual(s[0].slice(1, 6))
    const f = ANIMATIONS.flush
    expect(f[1].slice(4, 9)).toEqual(f[0].slice(3, 8))
  })
})

describe('symmetric glyphs', () => {
  it('the plus is as wide as it is tall', () => {
    const rows = GLYPHS.plus
    const across = rows[4].split('').filter((c) => c === '#').length
    const down = rows.filter((r) => r[4] === '#').length
    expect(across).toBe(down)
  })
})

describe('7 × 7 action glyphs', () => {
  it('plus, back, search and close all fill the same 7 × 7 box inside the 9 × 9 grid', () => {
    for (const name of ['plus', 'back', 'search', 'close'] as const) {
      const rows = GLYPHS[name]
      const lit = rows.flatMap((r, y) => r.split('').map((c, x) => (c === '#' ? [x, y] : null)).filter(Boolean)) as number[][]
      const xs = lit.map(([x]) => x), ys = lit.map(([, y]) => y)
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], name).toEqual([1, 7, 1, 7])
    }
  })
})
