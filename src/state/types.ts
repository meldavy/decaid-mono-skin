// Shapes of Decaid's live streams (see Decaid assets/api/websocket_v1.yml).

export type MachineStateName =
  | 'booting' | 'busy' | 'idle' | 'sleeping' | 'heating' | 'preheating' | 'espresso' | 'hotWater'
  | 'flush' | 'steam' | 'steamRinse' | 'skipStep' | 'cleaning' | 'descaling' | 'calibration'
  | 'selfTest' | 'airPurge' | 'needsWater' | 'error' | 'fwUpgrade' | string

export interface MachineSnapshot {
  timestamp: string
  state: { state: MachineStateName; substate: string }
  flow: number
  pressure: number
  targetFlow: number
  targetPressure: number
  mixTemperature: number
  groupTemperature: number
  targetMixTemperature: number
  targetGroupTemperature: number
  profileFrame: number
  steamTemperature: number
}

export interface ScaleSnapshot {
  status?: string
  weight?: number
  weightFlow?: number
  batteryLevel?: number
  timestamp?: string
}

export interface Device {
  name: string
  id: string
  state: 'connected' | 'connecting' | 'discovered' | 'disconnected' | string
  type: 'machine' | 'scale' | 'sensor' | string
  available?: boolean
}

export interface DevicesMessage {
  devices: Device[]
  scanning: boolean
}

export interface WaterLevels {
  currentLevel: number
  refillLevel: number
}

export interface ShotDecision {
  kind: 'advance' | 'stop' | 'finalize' | string
  reason: string
  details?: string
  data?: Record<string, unknown>
}

export interface ShotStateMessage {
  event: 'state' | 'decision'
  timestamp: string
  shotId: string | null
  state: 'idle' | 'preheating' | 'pouring' | 'stopping' | 'finished' | string
  machineState: string | null
  machineSubstate: string | null
  profileFrame: number | null
  scaleConnected: boolean
  scaleLost: boolean
  decision: ShotDecision | null
}
