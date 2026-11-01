import { useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { openSocket, type SocketHandle, type SocketStatus } from '../api/socket'
import { onShotState, onSnapshot, type ShotRecord } from './shot'
import { foldTtr, type TtrEstimate, type TtrFrame } from './timeToReady'
import type { Device, DevicesMessage, MachineSnapshot, ScaleSnapshot, ShotStateMessage, WaterLevels } from './types'

// Live, read-only view of Decaid. Opening these streams never changes anything in Decaid.

export interface LiveState {
  link: SocketStatus
  machine: MachineSnapshot | null
  machineAt: number // when the last machine snapshot arrived (ms)
  scale: ScaleSnapshot | null
  scaleAt: number // when the last scale reading arrived (ms)
  devices: Device[]
  scanning: boolean // Decaid is looking for devices
  water: WaterLevels | null
  shot: ShotRecord | null // the current or most recent espresso, until dismissed
  ttr: TtrEstimate | null // heating countdown, when the time-to-ready plugin is on
}

let state: LiveState = { link: 'connecting', machine: null, machineAt: 0, scale: null, scaleAt: 0, devices: [], scanning: false, water: null, shot: null, ttr: null }
const listeners = new Set<() => void>()
let handles: SocketHandle[] = []
// Decaid can announce a shot's id a moment before the first espresso frame arrives.
let announcedShotId: string | null = null

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function start() {
  handles = [
    openSocket<MachineSnapshot>('/ws/v1/machine/snapshot', (machine) => set({ machine, machineAt: Date.now(), shot: onSnapshot(state.shot, machine, Date.now(), scaleConnected(state.devices) && Date.now() - state.scaleAt < SCALE_STALE_MS ? state.scale?.weight : undefined, announcedShotId) }), (link) => set({ link })),
    openSocket<ScaleSnapshot>('/ws/v1/scale/snapshot', (scale) => set({ scale: { ...state.scale, ...scale }, scaleAt: Date.now() })),
    openSocket<DevicesMessage>('/ws/v1/devices', (message) => set({ devices: message.devices ?? [], scanning: message.scanning === true })),
    openSocket<WaterLevels>('/ws/v1/machine/waterLevels', (water) => set({ water })),
    openSocket<ShotStateMessage>('/ws/v1/machine/shotState', (msg) => {
      announcedShotId = msg.state === 'idle' ? null : msg.shotId ?? announcedShotId
      set({ shot: onShotState(state.shot, msg) })
    }),
  ]
}

// The heating countdown comes from an optional plugin. Only listen while it's enabled (checked once a minute),
// so a switched-off plugin doesn't mean endless failed connections.
const TTR_PLUGIN = 'time-to-ready.reaplugin'
let ttrSocket: SocketHandle | null = null
let ttrTimer: ReturnType<typeof setInterval> | undefined
async function checkTtrPlugin() {
  try {
    const plugins = await api.get<{ id: string; loaded?: boolean }[]>('/api/v1/plugins')
    const enabled = plugins.some((p) => p.id === TTR_PLUGIN && p.loaded === true)
    if (enabled && !ttrSocket) ttrSocket = openSocket<TtrFrame>(`/ws/v1/plugins/${TTR_PLUGIN}/timeToReady`, (frame) => set({ ttr: foldTtr(frame, Date.now(), state.ttr) }))
    if (!enabled && ttrSocket) { ttrSocket.close(); ttrSocket = null; set({ ttr: null }) }
  } catch {
    // Decaid unreachable: the link banner covers it; try again next round.
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    start()
    void checkTtrPlugin()
    ttrTimer = setInterval(checkTtrPlugin, 60_000)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      handles.forEach((handle) => handle.close())
      handles = []
      clearInterval(ttrTimer)
      ttrSocket?.close()
      ttrSocket = null
    }
  }
}

export function useLive<T>(select: (live: LiveState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export function machineConnected(devices: Device[]) {
  return devices.some((device) => device.type === 'machine' && device.state === 'connected')
}

// A scale that stops sending (asleep, out of range) shouldn't keep showing its last weight as live.
export const SCALE_STALE_MS = 2_000

export function scaleConnected(devices: Device[]) {
  return devices.some((device) => device.type === 'scale' && device.state === 'connected')
}

// Done with the finished shot (Shot complete → Done).
export function dismissShot() {
  set({ shot: null })
}
