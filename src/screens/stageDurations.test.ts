import { describe, expect, it } from 'vitest'
import { stageDurations } from './LiveShot'

describe('stageDurations', () => {
  it('measures each reached stage from its first sample to the next stage; unreached stages are null', () => {
    const samples = [
      { t: 0, frame: 0 }, { t: 2, frame: 0 }, { t: 4, frame: 1 }, { t: 9, frame: 1 }, { t: 10, frame: 2 }, { t: 13.5, frame: 2 },
    ].map((s) => ({ ...s, pressure: 0, flow: 0 }))
    expect(stageDurations({ samples }, 4)).toEqual([4, 6, 3.5, null])
  })
})
