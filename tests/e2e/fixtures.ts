import { test as base, expect } from '@playwright/test'
import { configurationSnapshot, DECAID, decaid, waitForMachineState } from './decaid'

type Workflow = Record<string, unknown> & { profile: { title: string }; context?: Record<string, unknown> }
export type ProfileRecord = { id: string; visibility: string; isDefault: boolean; profile: { title: string; target_weight?: number | null } }

// Puts Decaid back exactly as it was before each test: workflow, favourites, Mono's store, settings.
async function restore(snapshot: Awaited<ReturnType<typeof configurationSnapshot>>) {
  const wf = snapshot['/api/v1/workflow'] as Workflow
  await decaid('PUT', '/api/v1/workflow', {
    profile: wf.profile, context: wf.context, steamSettings: wf.steamSettings, hotWaterData: wf.hotWaterData, rinseData: wf.rinseData,
  })
  const settingsBefore = snapshot['/api/v1/settings'] as Record<string, unknown>
  const settingsNow = await decaid<Record<string, unknown>>('GET', '/api/v1/settings')
  const changed = Object.fromEntries(Object.entries(settingsBefore).filter(([k, v]) => JSON.stringify(settingsNow[k]) !== JSON.stringify(v)))
  if (Object.keys(changed).length) await decaid('POST', '/api/v1/settings', changed)
  // The machine's own settings: send back only what changed.
  for (const path of ['/api/v1/machine/settings', '/api/v1/machine/settings/advanced']) {
    const was = snapshot[path] as Record<string, unknown>
    if (!was || typeof was !== 'object') continue
    const now = await decaid<Record<string, unknown>>('GET', path)
    const changed = Object.fromEntries(Object.entries(was).filter(([k, v]) => JSON.stringify(now[k]) !== JSON.stringify(v)))
    if (Object.keys(changed).length) await decaid('POST', path, changed)
  }
  // Presence: settings, then wake schedules (added ones removed, changed ones put back).
  type Presence = { userPresenceEnabled: boolean; sleepTimeoutMinutes: number }
  type Schedule = { id: string; time: string; daysOfWeek: number[]; enabled: boolean }
  const pBefore = snapshot['/api/v1/presence/settings'] as Presence
  await decaid('POST', '/api/v1/presence/settings', { userPresenceEnabled: pBefore.userPresenceEnabled, sleepTimeoutMinutes: pBefore.sleepTimeoutMinutes })
  const schedBefore = snapshot['/api/v1/presence/schedules'] as Schedule[]
  for (const sch of await decaid<Schedule[]>('GET', '/api/v1/presence/schedules')) {
    const was = schedBefore.find((b) => b.id === sch.id)
    if (!was) await decaid('DELETE', `/api/v1/presence/schedules/${sch.id}`)
    else if (JSON.stringify(was) !== JSON.stringify(sch)) await decaid('PUT', `/api/v1/presence/schedules/${sch.id}`, { time: was.time, daysOfWeek: was.daysOfWeek, enabled: was.enabled })
  }
  for (const ns of ['streamline-app', 'mono']) {
    const before = snapshot[`/api/v1/store/${ns}`] as string[]
    const now = await decaid<string[]>('GET', `/api/v1/store/${ns}`)
    for (const key of now) if (!before.includes(key)) await decaid('DELETE', `/api/v1/store/${ns}/${key}`)
    for (const key of before) {
      const value = snapshot[`/api/v1/store/${ns}/${key}`]
      if (value !== undefined) await decaid('POST', `/api/v1/store/${ns}/${key}`, value)
    }
  }
}

// Tests may disconnect the mock scale or machine; bring them back before the next test.
async function reconnectDevices() {
  type Dev = { type: string; state: string }
  const ok = (ds: Dev[]) => ['machine', 'scale'].every((t) => ds.some((d) => d.type === t && d.state === 'connected'))
  if (ok(await decaid<Dev[]>('GET', '/api/v1/devices'))) return
  for (let i = 0; i < 30; i++) {
    await decaid('GET', '/api/v1/devices/scan?connect=true').catch(() => undefined)
    if (ok(await decaid<Dev[]>('GET', '/api/v1/devices'))) return
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error('mock machine / scale did not reconnect')
}

// Things only readable from a stream or a list: the tank warning level and which plugins are on.
async function extraSnapshot() {
  const refillLevel = await new Promise<number | null>((resolve) => {
    const ws = new WebSocket(DECAID.replace('http', 'ws') + '/ws/v1/machine/waterLevels')
    const t = setTimeout(() => { ws.close(); resolve(null) }, 3_000)
    ws.onmessage = (e) => { clearTimeout(t); ws.close(); resolve(JSON.parse(String(e.data)).refillLevel ?? null) }
  })
  const plugins = (await decaid<{ id: string; autoLoad?: boolean }[]>('GET', '/api/v1/plugins')).map((p) => [p.id, p.autoLoad === true] as const)
  return { refillLevel, plugins }
}

async function restoreExtra(before: Awaited<ReturnType<typeof extraSnapshot>>) {
  if (before.refillLevel != null) await decaid('POST', '/api/v1/machine/waterLevels', { refillLevel: before.refillLevel })
  const now = new Map((await decaid<{ id: string; autoLoad?: boolean }[]>('GET', '/api/v1/plugins')).map((p) => [p.id, p.autoLoad === true]))
  for (const [id, on] of before.plugins) if (now.get(id) !== on) await decaid('POST', `/api/v1/plugins/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`).catch(() => undefined)
}

async function fullSnapshot() {
  const snap = await configurationSnapshot()
  for (const ns of ['streamline-app', 'mono']) {
    for (const key of (snap[`/api/v1/store/${ns}`] as string[]) ?? []) {
      ;(snap as Record<string, unknown>)[`/api/v1/store/${ns}/${key}`] = await decaid('GET', `/api/v1/store/${ns}/${key}`)
    }
  }
  return snap
}

export const test = base.extend<{ decaidState: void; profiles: ProfileRecord[] }>({
  decaidState: [async ({}, use) => {
    await decaid('PUT', '/api/v1/machine/state/idle')
    await waitForMachineState('idle')
    const before = await fullSnapshot()
    const extraBefore = await extraSnapshot()
    const shotsBefore = new Set(await decaid<string[]>('GET', '/api/v1/shots/ids'))
    type Rec = { id: string; visibility: string; isDefault: boolean }
    const profilesBefore = await decaid<Rec[]>('GET', '/api/v1/profiles?includeHidden=true')
    let brewed = false
    const watch = new WebSocket(DECAID.replace('http', 'ws') + '/ws/v1/machine/shotState')
    watch.onmessage = (e) => { if (JSON.parse(String(e.data)).shotId) brewed = true }
    await use()
    await decaid('PUT', '/api/v1/machine/state/idle').catch(() => undefined)
    await reconnectDevices()
    // Shots brewed by a test are deleted so the simulator's history isn't polluted. Decaid saves the
    // record a few seconds after the machine goes idle, so wait for it when this test brewed.
    if (brewed) {
      let idleSince = 0
      for (let i = 0; i < 40; i++) {
        const fresh = (await decaid<string[]>('GET', '/api/v1/shots/ids')).filter((id) => !shotsBefore.has(id))
        const idle = (await decaid<{ state: { state: string } }>('GET', '/api/v1/machine/state')).state.state === 'idle'
        if (fresh.length && idle) break
        idleSince = idle ? idleSince || Date.now() : 0
        if (idleSince && Date.now() - idleSince > 6_000) break // a shot too short to be saved
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    watch.close()
    for (const id of await decaid<string[]>('GET', '/api/v1/shots/ids')) if (!shotsBefore.has(id)) await decaid('DELETE', `/api/v1/shots/${id}`)
    // Profiles: remove the ones the test created, put visibility back on the rest (deleted ones included).
    const visBefore = new Map(profilesBefore.map((p) => [p.id, p.visibility]))
    const now = await decaid<Rec[]>('GET', '/api/v1/profiles?includeHidden=true')
    const seen = new Set(now.map((p) => p.id))
    for (const p of now) {
      if (!visBefore.has(p.id)) { if (!p.isDefault) await decaid('DELETE', `/api/v1/profiles/${encodeURIComponent(p.id)}/purge`).catch(() => undefined) }
      else if (visBefore.get(p.id) !== p.visibility) await decaid('PUT', `/api/v1/profiles/${encodeURIComponent(p.id)}/visibility`, { visibility: visBefore.get(p.id) })
    }
    for (const [id, vis] of visBefore) if (!seen.has(id)) await decaid('PUT', `/api/v1/profiles/${encodeURIComponent(id)}/visibility`, { visibility: vis }).catch(() => undefined)
    // Profiles soft-deleted then left: purge any created-and-deleted leftovers.
    for (const p of await decaid<Rec[]>('GET', '/api/v1/profiles?visibility=deleted').catch(() => [] as Rec[])) {
      if (!visBefore.has(p.id) && !p.isDefault) await decaid('DELETE', `/api/v1/profiles/${encodeURIComponent(p.id)}/purge`).catch(() => undefined)
    }
    await restore(before)
    await restoreExtra(extraBefore)
    expect(await extraSnapshot(), 'tank level and plugins left as found').toEqual(extraBefore)
    expect(await fullSnapshot(), 'Decaid left as found').toEqual(before)
    expect((await decaid<Rec[]>('GET', '/api/v1/profiles?includeHidden=true')).map((p) => `${p.id}:${p.visibility}`).sort(), 'profiles left as found').toEqual(profilesBefore.map((p) => `${p.id}:${p.visibility}`).sort())
  }, { auto: true }],
  profiles: async ({}, use) => {
    const all = await decaid<ProfileRecord[]>('GET', '/api/v1/profiles')
    await use(all.filter((p) => p.visibility === 'visible'))
  },
})

export { expect }

export async function setFavourites(ids: (string | null)[]) {
  await decaid('POST', '/api/v1/store/streamline-app/favorite-profiles', Object.fromEntries(ids.map((id, i) => [String(i), id])))
}

export async function currentTitle() {
  return (await decaid<Workflow>('GET', '/api/v1/workflow')).profile.title
}

export async function loadByApi(record: ProfileRecord) {
  await decaid('PUT', '/api/v1/workflow', { profile: record.profile })
}
