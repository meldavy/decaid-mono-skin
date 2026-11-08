import { describe, expect, it } from 'vitest'
import { foldMilk, MILK_GRACE_MS, MILK_STALE_MS, milkProgress, NO_MILK, pickMilkSensor, steamMode } from './milk'

const sensor = (id: string, name: string, vendor: string, keys: string[]) => ({
  id, info: { name, vendor, data: keys.map((key) => ({ key, type: 'number' })) },
})

describe('steam milk temperature', () => {
  it('RUN-12 follows the sensor Decaid stops on: the Bengle probe first, else the first temperature sensor', () => {
    const cam = sensor('cam', 'Milk camera', 'DE1IRDriver', ['temperature', 'measured'])
    const hum = sensor('hum', 'Humidity', 'X', ['relativeHumidity'])
    const probe = sensor('probe', 'Bengle Milk Probe', 'DecentEspresso', ['temperature'])
    expect(pickMilkSensor([hum, cam])).toBe('cam')
    expect(pickMilkSensor([cam, probe])).toBe('probe')
    expect(pickMilkSensor([hum])).toBeNull()
  })

  it('RUN-13 ignores zero, negative and non-numeric readings, and remembers the first real one', () => {
    let t = foldMilk(NO_MILK, 0, 1000)
    expect(t).toBe(NO_MILK)
    t = foldMilk(t, 'x', 1000)
    t = foldMilk(t, 21.5, 2000)
    t = foldMilk(t, 0, 2500)
    t = foldMilk(t, 30, 3000)
    expect(t).toEqual({ celsius: 30, at: 3000, first: 21.5 })
  })

  it('RUN-13 uses the timer without a stop temperature, whatever the sensor says', () => {
    const t = foldMilk(NO_MILK, 40, 1000)
    expect(steamMode(0, t, 0, 1000)).toBe('time')
    expect(steamMode(undefined, t, 0, 1000)).toBe('time')
  })

  it('RUN-13 waits through the grace period, then settles on the timer if no reading came', () => {
    expect(steamMode(60, NO_MILK, 0, 1000)).toBe('waiting')
    expect(steamMode(60, NO_MILK, 0, MILK_GRACE_MS)).toBe('time')
  })

  it('RUN-14 switches to temperature on a fresh reading, back to the timer when it goes stale, and returns', () => {
    let t = foldMilk(NO_MILK, 20, 1000)
    expect(steamMode(60, t, 0, 1000)).toBe('temperature')
    expect(steamMode(60, t, 0, 1000 + MILK_STALE_MS)).toBe('temperature')
    expect(steamMode(60, t, 0, 1001 + MILK_STALE_MS)).toBe('lost')
    t = foldMilk(t, 45, 9000)
    expect(steamMode(60, t, 0, 9100)).toBe('temperature')
  })

  it('RUN-13 fills the bar from the first reading to the stop temperature', () => {
    let t = foldMilk(NO_MILK, 20, 0)
    expect(milkProgress(t, 60)).toBe(0)
    t = foldMilk(t, 40, 1)
    expect(milkProgress(t, 60)).toBe(0.5)
    t = foldMilk(t, 70, 2)
    expect(milkProgress(t, 60)).toBe(1)
    expect(milkProgress(NO_MILK, 60)).toBe(0)
    expect(milkProgress(foldMilk(NO_MILK, 65, 0), 60)).toBe(1)
  })
})
