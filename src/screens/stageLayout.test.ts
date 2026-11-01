import { describe, expect, it } from 'vitest'
import { currentMinWidth, rowSize, STAGE_MIN_WIDTH, stageSize } from './LiveShot'

describe('LIVE-03 stage name layout', () => {
  it('every stage keeps room for its name, however many there are (the row scrolls instead)', () => {
    expect(STAGE_MIN_WIDTH).toBe(136)
    expect(currentMinWidth(1114)).toBe(300)
    expect(currentMinWidth(960)).toBe(268)
  })

  it('uses one smaller size when a word is too long for the column', () => {
    expect(stageSize('Dripping', false)).toBe(22)
    expect(stageSize('Compressing', false)).toBe(19)
    expect(stageSize('Fill', true)).toBe(56)
    expect(stageSize('Compressing', true)).toBe(40)
    expect(stageSize('Extraction start', true)).toBe(40)
  })

  it('gives the other stages one shared size', () => {
    expect(rowSize(['Fill', 'Soak', 'Rise'])).toBe(22)
    expect(rowSize(['Fill', 'Compressing', 'Rise'])).toBe(19)
  })
})
