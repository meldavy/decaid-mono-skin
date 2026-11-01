import { describe, expect, it } from 'vitest'
import { enjoymentToStars, starsToEnjoyment, stopReasonLabel } from './shots'

describe('shot annotations', () => {
  it('maps five dots onto Decaid\'s 0–10 enjoyment and back; 0 dots clears', () => {
    expect([1, 3, 5].map(starsToEnjoyment)).toEqual([2, 6, 10])
    expect(starsToEnjoyment(0)).toBeNull()
    expect([null, undefined, 0, 2, 7, 10].map(enjoymentToStars)).toEqual([0, 0, 0, 1, 4, 5])
  })

  it('labels every stop reason in plain words; unknown codes show "ENDED", never the code', () => {
    expect(stopReasonLabel('targetWeight')).toBe('ENDED ON WEIGHT')
    expect(stopReasonLabel('apiStop')).toBe('STOPPED')
    expect(stopReasonLabel('appStop')).toBe('STOPPED')
    expect(stopReasonLabel('machineEnded')).toBe('FINISHED')
    expect(stopReasonLabel('somethingNew')).toBe('ENDED')
    expect(stopReasonLabel(null)).toBe('ENDED')
  })
})
