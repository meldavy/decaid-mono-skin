import { beanLine, dayLabel, groupByDay, lastShotLine, summarize, type StoredShot } from './history'

const m = (ms: number, substate: string, pressure: number, flow: number, weight?: number) => ({
  machine: { timestamp: new Date(Date.UTC(2026, 9, 31, 8, 0, 0) + ms).toISOString(), state: { state: 'espresso', substate }, pressure, flow },
  scale: weight === undefined ? null : { weight },
})

describe('summarize', () => {
  const shot: StoredShot = {
    id: 'a', timestamp: '2026-10-31T08:00:00',
    workflow: { context: { targetDoseWeight: 18 } },
    measurements: [m(0, 'preparingForShot', 0, 4, 0), m(1000, 'preinfusion', 2, 4, 0), m(5000, 'pouring', 9.1, 2, 10), m(29000, 'pouringDone', 6, 1.5, 36.2), m(31000, 'idle', 0, 0, 37)],
  }
  it('times the shot from the first pour frame and finds yield, ratio and peak', () => {
    const s = summarize(shot)
    expect(s.samples.map((x) => x.t)).toEqual([0, 4, 28])
    expect(s.duration).toBe(28)
    expect(s.yield).toBe(37) // the scale's last (after-drip) weight
    expect(s.dose).toBe(18)
    expect(s.ratio).toBeCloseTo(37 / 18)
    expect(s.peakPressure).toBe(9.1)
  })
  it('prefers the yield and dose the user entered', () => {
    const s = summarize({ ...shot, annotations: { actualYield: 36, actualDoseWeight: 18.5 } })
    expect(s.yield).toBe(36)
    expect(s.dose).toBe(18.5)
  })
  it('copes with no measurements or no scale', () => {
    expect(summarize({ id: 'b', timestamp: '' })).toEqual({ samples: [], duration: null, yield: null, dose: null, ratio: null, peakPressure: null })
    expect(summarize({ ...shot, measurements: shot.measurements!.map((x) => ({ ...x, scale: null })) }).yield).toBeNull()
  })
})

describe('days', () => {
  const now = new Date(2026, 9, 31, 12)
  it('labels today, yesterday, then weekday-date, with a year when it differs', () => {
    expect(dayLabel(new Date(2026, 9, 31, 7), now)).toBe('TODAY')
    expect(dayLabel(new Date(2026, 9, 30, 23), now)).toBe('YESTERDAY')
    expect(dayLabel(new Date(2026, 8, 10, 7), now)).toBe('THU 10 SEP')
    expect(dayLabel(new Date(2025, 8, 10, 7), now)).toBe('WED 10 SEP 2025')
  })
  it('groups consecutive shots of a day', () => {
    const groups = groupByDay([{ timestamp: '2026-10-31T09:00:00' }, { timestamp: '2026-10-31T07:00:00' }, { timestamp: '2026-10-29T07:00:00' }], now)
    expect(groups.map((g) => [g.label, g.shots.length])).toEqual([['TODAY', 2], ['THU 29 OCT', 1]])
  })
})

describe('beanLine', () => {
  it('joins roaster, coffee and dose, skipping blanks', () => {
    expect(beanLine({ id: 'a', timestamp: '', workflow: { context: { coffeeRoaster: 'The Big Roasters', coffeeName: 'Brasilia' } } }, 18)).toBe('The Big Roasters, Brasilia · 18.0 g in')
    expect(beanLine({ id: 'a', timestamp: '', workflow: { context: { coffeeName: ' ' } } }, null)).toBe('')
  })
})

describe('lastShotLine', () => {
  const now = new Date(2026, 9, 31, 12)
  const shot = (timestamp: Date, annotations: StoredShot['annotations'] = null): StoredShot => ({ id: 'x', timestamp: timestamp.toISOString(), annotations })
  it('says when and the rating, never the note', () => {
    expect(lastShotLine(shot(new Date(2026, 9, 31, 8), { enjoyment: 8, espressoNotes: 'Bright' }), false, now)).toBe('Last brewed today, rated 4/5')
    expect(lastShotLine(shot(new Date(2026, 9, 30, 8)), false, now)).toBe('Last brewed yesterday')
    expect(lastShotLine(shot(new Date(2026, 9, 27, 8)), false, now)).toBe('Last brewed on Tue 27 Oct')
  })
  it('no shot: never, or not lately when there are more shots than were looked at', () => {
    expect(lastShotLine(undefined, true, now)).toBe('Not brewed yet')
    expect(lastShotLine(undefined, false, now)).toBe('Not brewed recently')
  })
})
