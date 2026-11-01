import { describe, expect, it } from 'vitest'
import type { Profile, ProfileStep } from './profile'
import { nextVersion, addStageAfter, deleteStage, duplicateStage, moveStage, profileChanges, readField, saveProblem, setPump, writeField , writeExit, exitCondition, fieldSpec} from './editing'

const step = (over: Partial<ProfileStep> = {}): ProfileStep => ({ name: 'A', pump: 'pressure', pressure: 9, flow: null, seconds: 10, transition: 'fast', temperature: 93, ...over })
const prof = (steps: ProfileStep[]): Profile => ({ title: 'P', steps })

describe('EDIT-02 stage fields', () => {
  it('reads and writes each field; "off" fields read as null', () => {
    let s = step()
    expect(readField(s, 'target')).toBe(9)
    expect(readField(s, 'limit')).toBeNull()
    s = writeField(s, 'limit', 2.5)
    expect(readField(s, 'limit')).toBe(2.5)
    s = writeField(s, 'exitWeight', 36)
    expect(readField(s, 'exitWeight')).toBe(36)
    s = writeField(s, 'exitWeight', null)
    expect(readField(s, 'exitWeight')).toBeNull()
  })

  it('only one pressure / flow move-on condition at a time; above or below is part of it', () => {
    let s = writeExit(step(), 'pressure', 'over', 3)
    expect(fieldSpec('exitPressure', s).label).toBe('PRESSURE ABOVE')
    s = writeExit(s, 'pressure', 'under', 2)
    expect([readField(s, 'exitPressure'), fieldSpec('exitPressure', s).label]).toEqual([2, 'PRESSURE BELOW'])
    s = writeExit(s, 'flow', 'under', 1.5)
    expect(readField(s, 'exitPressure')).toBeNull()
    expect(readField(s, 'exitFlow')).toBe(1.5)
    expect(fieldSpec('exitPressure', s).label).toBe('PRESSURE')
    s = writeField(s, 'exitPressure', null) // clearing the other condition leaves the active one
    expect(readField(s, 'exitFlow')).toBe(1.5)
    s = writeField(s, 'exitFlow', 2.5) // a plain write keeps the direction
    expect(exitCondition(s, 'flow')).toBe('under')
  })

  it('switching control keeps a usable target', () => {
    const s = setPump(step(), 'flow')
    expect(s.pump).toBe('flow')
    expect(s.flow).toBe(2)
    expect(s.pressure).toBeNull()
  })
})

describe('EDIT-04 EDIT-05 stage operations', () => {
  const p = prof([step({ name: 'A' }), step({ name: 'B' }), step({ name: 'C' })])
  it('adds after the selected stage, duplicates, moves and deletes', () => {
    expect(addStageAfter(p, 0).steps.map((s) => s.name)).toEqual(['A', 'Stage 4', 'B', 'C'])
    expect(duplicateStage(p, 1).steps.map((s) => s.name)).toEqual(['A', 'B', 'B 2', 'C'])
    expect(moveStage(p, 0, 1).steps.map((s) => s.name)).toEqual(['B', 'A', 'C'])
    expect(moveStage(p, 0, 2).steps.map((s) => s.name)).toEqual(['B', 'C', 'A'])
    expect(moveStage(p, 2, 0).steps.map((s) => s.name)).toEqual(['C', 'A', 'B'])
    expect(moveStage(p, 0, -1)).toBe(p)
    expect(moveStage(p, 1, 1)).toBe(p)
    expect(deleteStage(p, 1).steps.map((s) => s.name)).toEqual(['A', 'C'])
  })

  it('never deletes the last stage', () => {
    const one = prof([step()])
    expect(deleteStage(one, 0)).toBe(one)
  })
})

describe('EDIT-03 save checks', () => {
  it('needs a name and no stage that would end at once', () => {
    expect(saveProblem({ ...prof([step()]), title: ' ' })).toBe('Give the profile a name.')
    expect(saveProblem(prof([step({ seconds: 0 })]))).toMatch(/Stage 1 has no duration/)
    expect(saveProblem(prof([step({ seconds: 0, exit: { type: 'pressure', condition: 'over', value: 3 } })]))).toBeNull()
  })
})

describe('MODAL-04 change list', () => {
  it('names what changed in plain words', () => {
    const before = prof([step({ name: 'Decline', pressure: 9 })])
    const after = { ...before, title: 'Mine', steps: [step({ name: 'Decline', pressure: 6, transition: 'smooth' })] }
    expect(profileChanges(before, after)).toEqual([
      { what: 'Name', from: 'P', to: 'Mine' },
      { what: 'Decline · pressure', from: '9', to: '6' },
      { what: 'Decline · transition', from: 'fast', to: 'smooth' },
    ])
  })
})

describe('LIB-07 copy versions', () => {
  it('bumps numeric versions and avoids ones already taken', () => {
    expect(nextVersion('2')).toBe('2.1')
    expect(nextVersion('2.1')).toBe('2.2')
    expect(nextVersion(undefined)).toBe('2.1')
    expect(nextVersion('beta')).toBe('beta copy')
    expect(nextVersion('2', ['2.1', '2.2'])).toBe('2.3')
  })
})
