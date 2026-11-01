import { api, ApiError } from '../api/client'
import { createResource } from './resource'
import type { MachineSnapshot } from './types'

export type RequestedState = 'espresso' | 'steam' | 'hotWater' | 'flush' | 'idle' | 'sleeping' | 'skipStep'

export class StartBlocked extends Error {}

export async function requestState(state: RequestedState) {
  try {
    await api.put(`/api/v1/machine/state/${state}`)
  } catch (error) {
    if (error instanceof ApiError && JSON.stringify(error.body ?? '').includes('block_no_scale')) {
      throw new StartBlocked('Connect a scale to start — "Require a scale" is on.')
    }
    throw error
  }
}

export function tare() {
  return api.put('/api/v1/scale/tare')
}

export const RUNNING = ['espresso', 'steam', 'hotWater', 'flush', 'steamRinse'] as const
export type Running = (typeof RUNNING)[number]

export function isRunning(state: string | undefined): state is Running {
  return !!state && (RUNNING as readonly string[]).includes(state)
}

export type Thermal = 'nolink' | 'offline' | 'stale' | 'asleep' | 'heating' | 'ready' | 'busy'

export const STALE_MS = 3_000
export const READY_BAND = 2 // °C either side of target

// What the display headline says. Never claims "ready" from old data.
export function thermalStatus(snapshot: MachineSnapshot | null, machineConnected: boolean, receivedAt: number, now: number, linkOpen = true): Thermal {
  if (!linkOpen) return 'nolink'
  if (!machineConnected || !snapshot) return 'offline'
  if (now - receivedAt > STALE_MS) return 'stale'
  const state = snapshot.state.state
  if (state === 'sleeping') return 'asleep'
  if (isRunning(state)) return 'busy'
  if (state === 'heating' || state === 'preheating') return 'heating'
  const { groupTemperature: t, targetGroupTemperature: target } = snapshot
  return target > 0 && Math.abs(t - target) <= READY_BAND ? 'ready' : 'heating'
}

// Machines with a group-head controller start shots, steam, water and flush on the machine itself; the tablet
// only stops them (as in Streamline). Decaid reports it as machine info `GHC`.
export interface MachineInfo { version?: string; model?: string; serialNumber?: string; GHC?: boolean }
export const machineInfo = createResource(() => api.get<MachineInfo>('/api/v1/machine/info'), 60_000)
export const GHC_MESSAGE = 'Start on the group head.'
