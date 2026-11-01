import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOTS_SCALE, heroStep } from '../screens/LiveShot'

const css = ['styles/tokens.css', 'screens/home.css', 'screens/live.css', 'overlays/run.css', 'sheets/sheet.css']
  .map((f) => readFileSync(join(process.cwd(), 'src', f), 'utf8')).join('\n')

describe('dot-matrix type scale', () => {
  it('the tokens match the scale used in code', () => {
    for (const [k, v] of Object.entries(DOTS_SCALE)) expect(css).toContain(`--dots-${k}: ${v}px;`)
  })

  it('every rule that sets the dot font takes its size from the scale', () => {
    // Rules for dot-matrix classes must not hard-code a pixel size.
    const dotRules = css.match(/\.(hero|headline|readout|live-status|run-title|run-value|big|row \.dots)[^{]*\{[^}]*\}/g) ?? []
    expect(dotRules.length).toBeGreaterThan(5)
    for (const rule of dotRules) expect(rule, rule).not.toMatch(/font-size:\s*\d/)
  })

  it('every size puts the font\'s dots (size / 10 apart) at the 9 px grid pitch or an even fraction of it', () => {
    for (const size of Object.values(DOTS_SCALE)) {
      const dot = size / 10
      const perStep = 9 / dot
      expect(Number.isInteger(Math.round(perStep * 1e6) / 1e6) || Number.isInteger(dot / 9), `${size}px`).toBe(true)
    }
  })

  it('fitted hero numbers step down the scale, never in between', () => {
    expect(heroStep(120)).toBe(90)
    expect(heroStep(80)).toBe(45)
    expect(heroStep(40)).toBe(30)
    expect(heroStep(10)).toBe(30)
  })
})
