import { describe, expect, it } from 'vitest'
import { elapsed, onShotState, onSnapshot } from './shot'
import type { MachineSnapshot, ShotStateMessage } from './types'

const snap = (state: string, substate: string, frame = 0, pressure = 0, flow = 0): MachineSnapshot => ({
  timestamp: '', state: { state, substate }, flow, pressure, targetFlow: 0, targetPressure: 0, mixTemperature: 90,
  groupTemperature: 90, targetMixTemperature: 90, targetGroupTemperature: 90, profileFrame: frame, steamTemperature: 140,
})
const msg = (over: Partial<ShotStateMessage>): ShotStateMessage => ({
  event: 'state', timestamp: '', shotId: 's1', state: 'pouring', machineState: 'espresso', machineSubstate: 'pouring',
  profileFrame: 0, scaleConnected: true, scaleLost: false, decision: null, ...over,
})

describe('shot recorder', () => {
  it('starts the clock at the first pour frame, not while preparing', () => {
    let s = onSnapshot(null, snap('espresso', 'preparingForShot'), 1000)
    expect(s?.startedAt).toBe(0)
    s = onSnapshot(s, snap('espresso', 'preinfusion', 0, 1, 6), 1500, 0.2)
    s = onSnapshot(s, snap('espresso', 'pouring', 1, 9, 2), 3500, 4)
    expect(s?.startedAt).toBe(1500)
    expect(s?.samples.map((x) => [x.t, x.pressure, x.weight])).toEqual([[0, 1, 0.2], [2, 9, 4]])
    expect(s?.frame).toBe(1)
    expect(elapsed(s!, 4500)).toBe(3)
  })

  it('freezes when the machine leaves espresso and keeps the record until dismissed', () => {
    let s = onSnapshot(null, snap('espresso', 'pouring'), 1000)
    s = onSnapshot(s, snap('idle', 'idle'), 9000)
    expect(s?.endedAt).toBe(9000)
    expect(s?.phase).toBe('stopping')
    expect(elapsed(s!, 20000)).toBe(8)
    expect(onSnapshot(s, snap('idle', 'idle'), 9500)).toBe(s)
  })

  it('LIVE-08 records stage reasons and the stop reason, ignores other shots, finishes on "finished"', () => {
    let s = onSnapshot(null, snap('espresso', 'pouring'), 1000)
    s = onShotState(s, msg({ decision: { kind: 'advance', reason: 'profileAdvance' }, profileFrame: 1 }))
    s = onShotState(s, msg({ shotId: 'other', state: 'finished' }))
    expect(s?.phase).toBe('pouring')
    s = onShotState(s, msg({ state: 'stopping', decision: { kind: 'stop', reason: 'targetWeight' } }))
    s = onShotState(s, msg({ state: 'finished' }))
    expect(s).toMatchObject({ id: 's1', phase: 'finished', stop: { reason: 'targetWeight' }, stageReasons: [{ frame: 1, reason: 'profileAdvance' }] })
  })

  it('takes a shot id announced before the first espresso frame', () => {
    const s = onSnapshot(null, snap('espresso', 'preparingForShot'), 1000, undefined, 'early-id')
    expect(s?.id).toBe('early-id')
  })

  it('a new espresso starts a fresh record', () => {
    let s = onSnapshot(null, snap('espresso', 'pouring'), 1000)
    s = onSnapshot(s, snap('idle', 'idle'), 2000)
    s = onSnapshot(s, snap('espresso', 'preparingForShot'), 5000)
    expect(s?.samples).toEqual([])
    expect(s?.endedAt).toBeNull()
  })
})
