import { api } from '../api/client'

export interface ShotAnnotations {
  actualDoseWeight?: number
  actualYield?: number
  enjoyment?: number | null // Decaid's 0–10 scale; Mono's five dots are two points each
  espressoNotes?: string | null
  extras?: Record<string, unknown> | null
}

export interface ShotRecordApi {
  id: string
  timestamp: string
  stopReason?: string | null
  annotations?: ShotAnnotations | null
  workflow?: { context?: { grinderSetting?: string | null; coffeeName?: string | null; coffeeRoaster?: string | null; [k: string]: unknown }; profile?: { title: string } }
}

export const getShot = (id: string) => api.get<ShotRecordApi>(`/api/v1/shots/${encodeURIComponent(id)}`)
export const updateShot = (id: string, patch: Partial<ShotRecordApi>) => api.put<ShotRecordApi>(`/api/v1/shots/${encodeURIComponent(id)}`, patch)

export const starsToEnjoyment = (stars: number) => (stars > 0 ? stars * 2 : null)
export const enjoymentToStars = (enjoyment: number | null | undefined) => (enjoyment ? Math.round(enjoyment / 2) : 0)

// Every stop reason Decaid sends (ShotDecisionReason), in plain words. Unknown codes never reach the screen.
const STOP_REASONS: Record<string, string> = {
  targetWeight: 'ENDED ON WEIGHT',
  targetVolume: 'ENDED ON VOLUME',
  apiStop: 'STOPPED',
  appStop: 'STOPPED',
  machineEnded: 'FINISHED',
  noScale: 'NO SCALE',
  disconnected: 'CONNECTION LOST',
  error: 'MACHINE ERROR',
}
export const stopReasonLabel = (reason: string | null | undefined) => (reason && STOP_REASONS[reason]) || 'ENDED'
