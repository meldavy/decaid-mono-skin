import type { MachineSnapshot, ShotDecision, ShotStateMessage } from './types'
import type { ShotSample } from '../ui/DotChart'

// The shot in progress (or just finished), built from the machine snapshot and Decaid's shot-state stream.

export interface ShotRecord {
  id: string | null
  phase: 'preparing' | 'pouring' | 'stopping' | 'finished'
  startedAt: number // ms, first pour frame (preinfusion or pouring)
  endedAt: number | null // ms, machine left espresso
  samples: (ShotSample & { weight?: number; frame: number })[]
  frame: number
  stageReasons: { frame: number; reason: string; details?: string }[]
  stop: ShotDecision | null
}

export const POURING_SUBSTATES = ['preinfusion', 'pouring', 'pouringDone']

export function emptyShot(): ShotRecord {
  return { id: null, phase: 'preparing', startedAt: 0, endedAt: null, samples: [], frame: 0, stageReasons: [], stop: null }
}

// Pure reducers so the rules are unit-testable.
export function onSnapshot(shot: ShotRecord | null, m: MachineSnapshot, now: number, weight?: number, pendingId: string | null = null): ShotRecord | null {
  const espresso = m.state.state === 'espresso'
  if (!espresso) {
    if (!shot || shot.endedAt) return shot
    return { ...shot, endedAt: now, phase: shot.phase === 'finished' ? 'finished' : 'stopping' }
  }
  let next = shot && !shot.endedAt ? shot : { ...emptyShot(), id: pendingId }
  if (!next.id && pendingId) next = { ...next, id: pendingId }
  if (POURING_SUBSTATES.includes(m.state.substate)) {
    if (!next.startedAt) next = { ...next, startedAt: now, phase: 'pouring' }
    const t = (now - next.startedAt) / 1000
    next = { ...next, frame: m.profileFrame, samples: [...next.samples, { t, pressure: m.pressure, flow: m.flow, weight, frame: m.profileFrame }] }
  }
  return next
}

export function onShotState(shot: ShotRecord | null, msg: ShotStateMessage): ShotRecord | null {
  if (!shot) return shot // the live store keeps msg.shotId and hands it to the record when it's created
  let next = shot
  if (msg.shotId && !next.id) next = { ...next, id: msg.shotId }
  if (msg.shotId && next.id && msg.shotId !== next.id) return next // a different shot's late message
  const d = msg.decision
  if (d?.kind === 'advance') next = { ...next, stageReasons: [...next.stageReasons, { frame: msg.profileFrame ?? next.frame, reason: d.reason, details: d.details }] }
  if (d?.kind === 'stop') next = { ...next, stop: d }
  if (msg.state === 'stopping' && next.phase !== 'finished') next = { ...next, phase: 'stopping' }
  if (msg.state === 'finished') next = { ...next, phase: 'finished' }
  return next
}

export function elapsed(shot: ShotRecord, now: number) {
  if (!shot.startedAt) return 0
  return ((shot.endedAt ?? now) - shot.startedAt) / 1000
}
