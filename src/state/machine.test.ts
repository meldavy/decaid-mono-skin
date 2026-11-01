import { describe, expect, it } from 'vitest'
import { thermalStatus } from './machine'
import type { MachineSnapshot } from './types'

const snap = (over: Partial<MachineSnapshot> & { s?: string } = {}): MachineSnapshot => ({
  timestamp: '', state: { state: over.s ?? 'idle', substate: 'idle' }, flow: 0, pressure: 0, targetFlow: 0, targetPressure: 0,
  mixTemperature: 90, groupTemperature: 90, targetMixTemperature: 90, targetGroupTemperature: 90, profileFrame: 0, steamTemperature: 140, ...over,
})

describe('thermal status', () => {
  it('is ready only within the band of the target, with fresh data', () => {
    expect(thermalStatus(snap({ groupTemperature: 88.5 }), true, 1000, 1500)).toBe('ready')
    expect(thermalStatus(snap({ groupTemperature: 80 }), true, 1000, 1500)).toBe('heating')
  })

  it('never says ready from stale data or without a machine', () => {
    expect(thermalStatus(snap(), true, 1000, 5000)).toBe('stale')
    expect(thermalStatus(snap(), false, 1000, 1500)).toBe('offline')
    expect(thermalStatus(null, true, 1000, 1500)).toBe('offline')
    expect(thermalStatus(snap(), true, 1000, 1500, false)).toBe('nolink')
  })

  it('reports sleep and running states', () => {
    expect(thermalStatus(snap({ s: 'sleeping' }), true, 1000, 1500)).toBe('asleep')
    expect(thermalStatus(snap({ s: 'steam' }), true, 1000, 1500)).toBe('busy')
    expect(thermalStatus(snap({ s: 'heating', groupTemperature: 90 }), true, 1000, 1500)).toBe('heating')
  })
})
