import { api } from '../api/client'
import type { Profile } from '../domain/profile'
import { createResource } from './resource'

export interface Workflow {
  id: string
  name: string
  profile: Profile
  context?: { targetDoseWeight?: number; targetYield?: number; grinderSetting?: string; [k: string]: unknown }
  steamSettings: { targetTemperature: number; duration: number; flow: number; stopAtTemperature?: number }
  hotWaterData: { targetTemperature: number; duration: number; volume: number; flow: number }
  rinseData: { targetTemperature: number; duration: number; flow: number }
}

export type WorkflowPatch = {
  [K in keyof Workflow]?: Workflow[K] extends object ? Partial<Workflow[K]> : Workflow[K]
}

export const workflow = createResource(() => api.get<Workflow>('/api/v1/workflow'))

// Decaid deep-merges the patch. Send only what the person changed.
export async function saveWorkflow(patch: WorkflowPatch): Promise<Workflow> {
  const next = await api.put<Workflow>('/api/v1/workflow', patch)
  const confirmed = next && typeof next === 'object' && 'steamSettings' in next ? next : await api.get<Workflow>('/api/v1/workflow')
  workflow.set(confirmed)
  return confirmed
}
