import { api } from '../api/client'
import type { WakeSchedule } from '../domain/schedule'
import { createResource } from './resource'

// Decaid settings Mono's Settings screen shows. Every change writes only the key the person changed.

export interface AppSettings {
  weightFlowMultiplier: number
  hotWaterFlowMultiplier: number
  scalePowerMode: 'disabled' | 'displayOff' | 'disconnect'
  blockOnNoScale: boolean
  blockTareDuringShot: boolean
  stopHotWaterAtWeight: boolean
  chargingMode: 'disabled' | 'longevity' | 'balanced' | 'highAvailability'
  nightModeEnabled: boolean
  nightModeSleepTime: number // minutes after midnight
  nightModeMorningTime: number
  lowBatteryBrightnessLimit: boolean
  keepAwake: boolean
  automaticUpdateCheck: boolean
  defaultSkinId: string
  [k: string]: unknown
}

export const appSettings = createResource(() => api.get<AppSettings>('/api/v1/settings'), 15_000)
export async function saveSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await api.post('/api/v1/settings', { [key]: value })
  await appSettings.refresh()
}

export interface Presence { userPresenceEnabled: boolean; sleepTimeoutMinutes: number; schedules: WakeSchedule[] }
export const presence = createResource(() => api.get<Presence>('/api/v1/presence/settings'), 15_000)
export async function savePresence(patch: Partial<Omit<Presence, 'schedules'>>) {
  await api.post('/api/v1/presence/settings', patch)
  await presence.refresh()
}
export async function addSchedule(s: Omit<WakeSchedule, 'id'>) {
  await api.post('/api/v1/presence/schedules', s)
  await presence.refresh()
}
export async function updateSchedule(id: string, s: Partial<WakeSchedule>) {
  await api.put(`/api/v1/presence/schedules/${encodeURIComponent(id)}`, s)
  await presence.refresh()
}
export async function deleteSchedule(id: string) {
  await api.del(`/api/v1/presence/schedules/${encodeURIComponent(id)}`)
  await presence.refresh()
}

export interface DisplayState { brightness: number; requestedBrightness: number; wakeLockEnabled: boolean; wakeLockOverride: boolean; platformSupported: { brightness: boolean; wakeLock: boolean } }
export const display = createResource(() => api.get<DisplayState>('/api/v1/display'), 15_000)
export async function setBrightness(brightness: number) {
  await api.put('/api/v1/display/brightness', { brightness })
  await display.refresh()
}

// A setting a plugin declares in its manifest. Decaid builds its own settings dialog from these.
export interface PluginSetting { type: 'string' | 'number' | 'boolean' | 'enum'; label?: string; description?: string; default?: unknown; secure?: boolean; values?: string[] }
export interface Plugin { id: string; name: string; author?: string; description?: string; version?: string; loaded?: boolean; autoLoad?: boolean; settings?: Record<string, PluginSetting> }
export const plugins = createResource(() => api.get<Plugin[]>('/api/v1/plugins'), 30_000)
export async function setPluginEnabled(id: string, on: boolean) {
  try {
    await api.post(`/api/v1/plugins/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`)
  } finally {
    await plugins.refresh()
  }
}

export interface UpdateState { phase: string; currentVersion: string; latestVersion: string | null; releaseNotes: string | null; installable: boolean; error: string | null }
export const appUpdate = createResource(() => api.get<UpdateState>('/api/v1/update'), 60_000)

export interface Skin { id: string; name: string; description?: string; version?: string; isBundled?: boolean }
export const skins = createResource(() => api.get<Skin[]>('/api/v1/webui/skins'), 60_000)
export async function setDefaultSkin(skinId: string) {
  await api.put('/api/v1/webui/skins/default', { skinId })
}

export async function setRefillLevel(refillLevel: number) {
  await api.post('/api/v1/machine/waterLevels', { refillLevel })
}

export interface FirmwareInfo { artifacts?: { id: string; versionLabel: string; build: number; channel?: string }[]; current?: { build?: number; version?: string } | null; [k: string]: unknown }
export const firmware = createResource(() => api.get<FirmwareInfo>('/api/v1/machine/firmware'), 60_000)

// Plain words for Decaid's enum values (never show the codes).
export const SCALE_POWER: Record<AppSettings['scalePowerMode'], string> = { disabled: 'Leave it on', displayOff: 'Turn its display off', disconnect: 'Disconnect it' }
export const CHARGING: Record<AppSettings['chargingMode'], string> = { disabled: 'Always charge', longevity: 'Protect the battery', balanced: 'Balanced', highAvailability: 'Keep it full' }

// The machine's own settings (Decaid writes them to the DE1). Each change sends only that key.
export interface MachineSettings { fan: number; usb: boolean; tankTemp: number; steamPurgeMode: number; [k: string]: unknown }
export interface MachineAdvanced { heaterIdleTemp: number; heaterPh1Flow: number; heaterPh2Flow: number; heaterPh2Timeout: number; heaterVoltage?: number; refillKitSetting: number; [k: string]: unknown }
export const machineSettings = createResource(() => api.get<MachineSettings>('/api/v1/machine/settings'), 30_000)
export const machineAdvanced = createResource(() => api.get<MachineAdvanced>('/api/v1/machine/settings/advanced'), 30_000)
export async function saveMachineSetting(key: string, value: unknown) {
  await api.post('/api/v1/machine/settings', { [key]: value })
  await machineSettings.refresh()
}
export async function saveMachineAdvanced(key: string, value: unknown) {
  await api.post('/api/v1/machine/settings/advanced', { [key]: value })
  await machineAdvanced.refresh()
}
export const forgetDevice = (deviceId: string) => api.put('/api/v1/devices/forget', { deviceId })

// Current values. A secure setting comes back as { isSet } only; its value never leaves Decaid.
export type PluginValues = Record<string, unknown>
export const pluginSettings = (id: string) => api.get<PluginValues>(`/api/v1/plugins/${encodeURIComponent(id)}/settings`)
// Decaid merges what's sent: send only changed keys. null clears a value.
export const savePluginSettings = (id: string, patch: PluginValues) => api.post<PluginValues>(`/api/v1/plugins/${encodeURIComponent(id)}/settings`, patch)
