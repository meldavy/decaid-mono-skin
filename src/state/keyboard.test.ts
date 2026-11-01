import { describe, expect, it } from 'vitest'
import { decideKey, DEFAULT_KEYS, withKeyDefaults } from './keyboard'

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({ key: k, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over })
const home = { machineState: 'idle', onHome: true, dialogOpen: false }

describe('keyboard shortcuts', () => {
  it('KEY-01 KEY-02 start keys and sleep on Home', () => {
    expect(decideKey(key('e'), DEFAULT_KEYS, home)).toEqual({ kind: 'start', action: 'espresso' })
    expect(decideKey(key('W'), DEFAULT_KEYS, home)).toEqual({ kind: 'start', action: 'hotWater' })
    expect(decideKey(key('p'), DEFAULT_KEYS, home)).toEqual({ kind: 'start', action: 'sleep' })
  })

  it('KEY-03 KEY-04 KEY-05 while running: Space or the running key stops; other start keys do nothing', () => {
    const steaming = { machineState: 'steam', onHome: false, dialogOpen: false }
    expect(decideKey(key(' '), DEFAULT_KEYS, steaming)).toEqual({ kind: 'stop' })
    expect(decideKey(key('s'), DEFAULT_KEYS, steaming)).toEqual({ kind: 'stop' })
    expect(decideKey(key('e'), DEFAULT_KEYS, steaming)).toEqual({ kind: 'none' })
  })

  it('KEY-06 KEY-07 nothing off Home, in dialogs, while typing, on repeat or with modifiers', () => {
    expect(decideKey(key('e'), DEFAULT_KEYS, { ...home, onHome: false })).toEqual({ kind: 'none' })
    expect(decideKey(key('e'), DEFAULT_KEYS, { ...home, dialogOpen: true })).toEqual({ kind: 'none' })
    expect(decideKey(key('e', { repeat: true }), DEFAULT_KEYS, home)).toEqual({ kind: 'none' })
    expect(decideKey(key('e', { ctrlKey: true }), DEFAULT_KEYS, home)).toEqual({ kind: 'none' })
    const input = document.createElement('input')
    expect(decideKey({ ...key('e'), target: input }, DEFAULT_KEYS, home)).toEqual({ kind: 'none' })
  })

  it('KEY-08 profile keys load a profile on Home', () => {
    const cfg = withKeyDefaults({ profiles: { '1': 'profile:abc' } })
    expect(decideKey(key('1'), cfg, home)).toEqual({ kind: 'profile', profileId: 'profile:abc' })
  })

  it('KEY-09 switched off, nothing works — Stop included', () => {
    const off = withKeyDefaults({ enabled: false })
    expect(decideKey(key('e'), off, home)).toEqual({ kind: 'none' })
    expect(decideKey(key(' '), off, { ...home, machineState: 'espresso' })).toEqual({ kind: 'none' })
  })

  it('remapped keys replace the defaults', () => {
    const cfg = withKeyDefaults({ actions: { ...DEFAULT_KEYS.actions, espresso: 'b' } })
    expect(decideKey(key('b'), cfg, home)).toEqual({ kind: 'start', action: 'espresso' })
    expect(decideKey(key('e'), cfg, home)).toEqual({ kind: 'none' })
  })
})
