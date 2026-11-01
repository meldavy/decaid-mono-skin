#!/usr/bin/env node
// Captures every built screen and state to screens/<name>.png for visual review.
// Never changes Decaid: states are faked in the browser (routes / WebSocket rewrites).
//   node scripts/screens.mjs [filter]      e.g. `node scripts/screens.mjs run-` for the running modals only
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MONO_URL ?? 'http://localhost:5173/'
const API = process.env.DECAID_URL ?? 'http://localhost:8080'
// SIZE=1000x600 captures every state at that viewport, into screens/1000x600/.
const SIZE = process.env.SIZE?.match(/^(\d+)x(\d+)$/)
const OUT = new URL(`../screens/${SIZE ? `${SIZE[0]}/` : ''}`, import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const profiles = await (await fetch(`${API}/api/v1/profiles`)).json()
const visible = profiles.filter((p) => p.visibility === 'visible')
const byTitle = (t) => profiles.find((p) => p.profile.title === t) ?? visible[0]
const adaptive = byTitle('Adaptive v3')
const weber = byTitle('Cleaning/Weber Spring Clean') // 15 stages
const favs = { 0: visible[1].id, 1: adaptive.id, 2: visible[5].id, 3: null, 4: visible[9].id }

// Rewrites frames of a live stream.
const rewrite = (page, path, fn) => page.routeWebSocket(path, (ws) => {
  const server = ws.connectToServer()
  server.onMessage((m) => ws.send(JSON.stringify(fn(JSON.parse(String(m))))))
})
const machineState = (page, state, extra = {}) =>
  rewrite(page, /\/ws\/v1\/machine\/snapshot/, (m) => ({ ...m, ...extra, state: { state, substate: state === 'idle' ? 'idle' : 'pouring' } }))
const withProfile = (page, profile) => page.route('**/api/v1/workflow', async (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  const res = await route.fetch()
  const wf = await res.json()
  wf.profile = profile
  await route.fulfill({ response: res, json: wf })
})
const withFavourites = (page, value) => page.route('**/api/v1/store/streamline-app/favorite-profiles', (r) => r.fulfill({ json: value }))
const noScale = (page) => rewrite(page, /\/ws\/v1\/devices/, (m) => ({ ...m, devices: m.devices.filter((d) => d.type !== 'scale') }))

// A synthetic espresso: machine frames follow the profile's steps, weight rises with flow.
const fakeShot = async (page, profile, { yieldTarget = 36, endAfter = 0, speed = 1 } = {}) => {
  const steps = profile.steps
  const bounds = []
  let acc = 0
  for (const st of steps) { acc += Math.min(20, Math.max(1, st.seconds || 0)); bounds.push(acc) }
  const t0 = Date.now()
  const at = () => {
    const t = ((Date.now() - t0) / 1000) * speed
    const frame = bounds.findIndex((b) => t < b) < 0 ? steps.length - 1 : bounds.findIndex((b) => t < b)
    const st = steps[frame === -1 ? steps.length - 1 : frame]
    const pressure = st.pump === 'pressure' ? st.pressure : (st.limiter?.value || 4) * 0.8
    const flow = st.pump === 'flow' ? st.flow : (st.limiter?.value || 2.2) * 0.9
    return { t, frame, pressure: pressure + 0.3 * Math.sin(t * 1.7), flow: flow + 0.15 * Math.sin(t * 1.3 + 2) }
  }
  await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => {
    const timer = setInterval(() => {
      const { t, frame, pressure, flow } = at()
      if (endAfter && t > endAfter) { ws.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: 'idle', substate: 'idle' }, flow: 0, pressure: 0, targetFlow: 0, targetPressure: 0, mixTemperature: 92, groupTemperature: 92, targetMixTemperature: 93, targetGroupTemperature: 93, profileFrame: 0, steamTemperature: 150 })); return }
      ws.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: 'espresso', substate: t < 2 ? 'preinfusion' : 'pouring' }, flow, pressure, targetFlow: flow, targetPressure: pressure, mixTemperature: 92.6, groupTemperature: 92.8, targetMixTemperature: 93, targetGroupTemperature: 93, profileFrame: frame, steamTemperature: 150 }))
    }, 100)
    ws.onClose(() => clearInterval(timer))
  })
  await page.routeWebSocket(/\/ws\/v1\/scale\/snapshot/, (ws) => {
    const timer = setInterval(() => { const { t } = at(); ws.send(JSON.stringify({ weight: Math.max(0, (Math.min(t, endAfter || t) - 3) * 1.9), weightFlow: 1.9 })) }, 100)
    ws.onClose(() => clearInterval(timer))
  })
  await page.routeWebSocket(/\/ws\/v1\/machine\/shotState/, (ws) => {
    const base = { timestamp: '', shotId: 'fake-shot', machineState: 'espresso', machineSubstate: 'pouring', profileFrame: 0, scaleConnected: true, scaleLost: false }
    ws.send(JSON.stringify({ ...base, event: 'state', state: 'pouring', decision: null }))
    if (endAfter) setTimeout(() => {
      ws.send(JSON.stringify({ ...base, event: 'decision', state: 'stopping', decision: { kind: 'stop', reason: 'targetWeight' } }))
      setTimeout(() => ws.send(JSON.stringify({ ...base, event: 'state', state: 'finished', decision: null })), 800)
    }, (endAfter / speed) * 1000)
  })
  await page.route('**/api/v1/shots/fake-shot', (route) => route.fulfill({ json: { id: 'fake-shot', timestamp: '', annotations: { enjoyment: 8, espressoNotes: 'Sweet, a touch sour at the end.' } } }))
  await page.route('**/api/v1/workflow', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch(); const wf = await res.json()
    wf.profile = profile; wf.context = { ...wf.context, targetYield: yieldTarget }
    await route.fulfill({ response: res, json: wf })
  })
}

const STATES = {
  'home': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs) },
  'home-detail': async (page) => { await withFavourites(page, favs) },
  'home-not-favourite': async (page) => { await withProfile(page, byTitle('Default').profile); await withFavourites(page, favs) },
  'home-long-names': async (page) => {
    const longest = [...visible].sort((a, b) => b.profile.title.length - a.profile.title.length)
    await withProfile(page, longest[0].profile)
    await withFavourites(page, { 0: longest[1].id, 1: longest[0].id, 2: longest[2].id, 3: longest[3].id, 4: null })
  },
  'home-unbroken-name': async (page) => {
    const fake = { ...adaptive, profile: { ...adaptive.profile, title: 'Supercalifragilisticexpialidociousprofilenamewithoutanyspaces', author: 'An extremely long author name that keeps going and going' } }
    await page.route('**/api/v1/profiles', (r) => r.fulfill({ json: [fake, ...profiles.filter((p) => p.id !== adaptive.id)] }))
    await withProfile(page, fake.profile); await withFavourites(page, favs)
  },
  'sheet-long-name': async (page) => { const longest = [...visible].sort((a, b) => b.profile.title.length - a.profile.title.length); await withProfile(page, longest[0].profile) },
  'home-empty-slots': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, { 0: adaptive.id }) },
  'home-no-scale': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs); await noScale(page) },
  'home-heating': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs); await rewrite(page, /\/ws\/v1\/machine\/snapshot/, (m) => ({ ...m, groupTemperature: 61.3 })) },
  'home-no-machine': async (page) => { await withFavourites(page, favs); await rewrite(page, /\/ws\/v1\/devices/, (m) => ({ ...m, devices: m.devices.filter((d) => d.type !== 'machine') })) },
  'home-no-link': async (page) => { await withFavourites(page, favs); await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => ws.close()) },
  'sheet-temp': async (page) => { await withProfile(page, adaptive.profile) },
  'sheet-dose': async (page) => { await withProfile(page, adaptive.profile) },
  'sheet-yield': async (page) => { await withProfile(page, adaptive.profile) },
  // An allongé: yield over 100 g.
  'sheet-yield-allonge': async (page) => {
    const rao = byTitle('Rao Allongé')
    await page.route('**/api/v1/workflow', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch(); const wf = await res.json()
      await route.fulfill({ response: res, json: { ...wf, profile: rao.profile, context: { ...wf.context, targetYield: 135 } } })
    })
  },
  'sheet-time': async (page) => { await withProfile(page, adaptive.profile) },
  'sheet-steam-off': async (page) => { await withProfile(page, adaptive.profile) },
  'live-mid-1024x600': async (page) => { await fakeShot(page, adaptive.profile) },
  'live-mid-1280x800': async (page) => { await fakeShot(page, adaptive.profile) },
  'live-mid-1920x1200': async (page) => { await fakeShot(page, adaptive.profile) },
  'done-1024x600': async (page) => { await fakeShot(page, adaptive.profile, { endAfter: 10 }) },
  'live-early': async (page) => { await fakeShot(page, adaptive.profile) },
  'live-mid': async (page) => { await fakeShot(page, adaptive.profile) },
  'live-long-names': async (page) => {
    const p = { ...adaptive.profile, title: 'Pour over basket/Cold brew 22g in, 375ml out — extended', author: 'An extremely long author name that keeps going', steps: adaptive.profile.steps.map((st, i) => ({ ...st, name: i === 2 ? 'Supercalifragilistic compressing stage' : `${st.name} with a much longer stage name` })) }
    await fakeShot(page, p)
  },
  'done': async (page) => { await fakeShot(page, adaptive.profile, { endAfter: 22 }) },
  'done-notes': async (page) => { await fakeShot(page, adaptive.profile, { endAfter: 22 }) },
  'sleep': async (page) => {
    await machineState(page, 'sleeping')
    await page.route('**/api/v1/presence/schedules', (r) => r.fulfill({ json: [{ id: 's', time: '06:30', daysOfWeek: [], enabled: true }] }))
    await page.route('**/api/v1/shots/latest', (r) => r.fulfill({ json: { timestamp: new Date(Date.now() - 3_600_000).toISOString(), workflow: { profile: { title: 'Adaptive v3' } } } }))
  },
  'sleep-1024x600': async (page) => { await machineState(page, 'sleeping') },
  'refill': async (page) => {
    await page.routeWebSocket(/\/ws\/v1\/machine\/waterLevels/, (ws) => { const t = setInterval(() => ws.send(JSON.stringify({ currentLevel: 4, refillLevel: 5 })), 300); ws.onClose(() => clearInterval(t)) })
  },
  'library': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs) },
  'library-long-names': async (page) => {
    const longOnes = [...visible].sort((a, b) => b.profile.title.length - a.profile.title.length).slice(0, 4)
    const fake = { ...longOnes[0], profile: { ...longOnes[0].profile, title: 'Supercalifragilisticexpialidociousprofilenamewithoutanyspaces', notes: 'A very long description that goes on and on about this profile and how it was dialled in over many mornings with several different coffees, grinders and baskets until it was just right for a medium roast.' } }
    await page.route('**/api/v1/profiles?includeHidden=true', async (route) => { const res = await route.fetch(); const list = await res.json(); await route.fulfill({ response: res, json: [fake, ...list.filter((p) => p.id !== fake.id)] }) })
    await withProfile(page, fake.profile); await withFavourites(page, { 0: fake.id, 1: longOnes[1].id, 2: null, 3: null, 4: null })
  },
  'library-empty-search': async (page) => { await withProfile(page, adaptive.profile) },
  'library-delete': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs) },
  'favs': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, { ...favs, 3: null }) },
  'favs-drag': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs) },
  'favs-detail': async (page) => { await withProfile(page, adaptive.profile); await withFavourites(page, favs) },
  'editor': async (page) => { await withProfile(page, adaptive.profile) },
  'editor-many': async (page) => { await withProfile(page, weber.profile) },
  'editor-many-end': async (page) => { await withProfile(page, weber.profile) },
  'live-many': async (page) => { await fakeShot(page, weber.profile, { speed: 8 }) },
  // Past the first 40 s: the chart has widened in 10 s steps and columns share samples.
  'live-long-shot': async (page) => { await fakeShot(page, byTitle('Rao Allongé').profile, { yieldTarget: 135 }) },
  'done-many-early': async (page) => { await fakeShot(page, weber.profile, { endAfter: 8 }) },
  'done-many-end': async (page) => { await fakeShot(page, weber.profile, { endAfter: 218, speed: 12 }) },
  'editor-1024x600': async (page) => { await withProfile(page, adaptive.profile) },
  'editor-value': async (page) => { await withProfile(page, adaptive.profile) },
  'editor-unsaved': async (page) => { await withProfile(page, adaptive.profile) },
  'editor-long-names': async (page) => {
    const fake = { ...adaptive, profile: { ...adaptive.profile, title: 'Supercalifragilistic expialidocious profile with a very long name', steps: adaptive.profile.steps.map((st, i) => ({ ...st, name: i === 4 ? 'Supercalifragilisticexpialidociousstage' : `${st.name} with a longer name` })) } }
    await page.route('**/api/v1/profiles?includeHidden=true', async (route) => { const res = await route.fetch(); const list = await res.json(); await route.fulfill({ response: res, json: list.map((p) => (p.id === adaptive.id ? fake : p)) }) })
    await withProfile(page, fake.profile)
  },
  'run-steam': async (page) => { await machineState(page, 'steam', { flow: 1.6, steamTemperature: 158 }) },
  'run-water': async (page) => { await machineState(page, 'hotWater', { flow: 8.2, mixTemperature: 84 }) },
  'run-water-no-scale': async (page) => { await machineState(page, 'hotWater', { flow: 8.2, mixTemperature: 84 }); await noScale(page) },
  'run-flush': async (page) => { await machineState(page, 'flush', { flow: 6.0, mixTemperature: 91 }) },
  'msg-cleaning': async (page) => { await machineState(page, 'cleaning') },
  'msg-error': async (page) => { await machineState(page, 'error') },
  'banner-machine': async (page) => { await rewrite(page, /\/ws\/v1\/devices/, (m) => ({ ...m, devices: m.devices.filter((d) => d.type !== 'machine') })) },
  'banner-link': async (page) => { await page.routeWebSocket(/:8080\/ws\//, (ws) => ws.close()) },
  'banner-link-library': async (page) => { await page.routeWebSocket(/:8080\/ws\//, (ws) => ws.close()) },
  'home-ghc': async (page) => { await page.route('**/api/v1/machine/info', (r) => r.fulfill({ json: { model: 'Bengle', GHC: true } })) },
  'hist': async () => {},
  'hist-1024x600': async () => {},
  'hist-empty': async (page) => { await page.route('**/api/v1/shots?limit=*', (r) => r.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } })) },
  'hist-search-empty': async () => {},
  'hist-long': async (page) => {
    const long = (s) => ({ ...s, annotations: { ...(s.annotations ?? {}), enjoyment: 8, espressoNotes: 'Supercalifragilisticexpialidociousnotewithoutanyspacesatallthatkeepsgoing and then a normal sentence that wraps across a couple of lines to see how the note area copes with a long entry. 😀☕️' }, workflow: { ...s.workflow, profile: { ...s.workflow.profile, title: 'Supercalifragilisticexpialidociousprofilenamewithoutanyspaces' }, context: { ...(s.workflow.context ?? {}), coffeeRoaster: 'An Extremely Long Roaster Name Coffee Company', coffeeName: 'Finca Supercalifragilistic Natural Anaerobic Geisha Lot 42', grinderSetting: '4.5 + a quarter turn' } } })
    await page.route('**/api/v1/shots?*', async (r) => {
      const res = await r.fetch(); const body = await res.json()
      if (Array.isArray(body)) return r.fulfill({ response: res, json: body.map((s, i) => (i === 0 ? long(s) : s)) })
      return r.fulfill({ response: res, json: { ...body, items: body.items.map((s, i) => (i === 0 ? long(s) : s)) } })
    })
  },
  'set-brewing': async () => {},
  'set-machine': async () => {},
  'set-machine-1024x600': async () => {},
  'set-sleep-night': async (page) => { await page.route('**/api/v1/settings', async (r) => { if (r.request().method() !== 'GET') return r.fallback(); const res = await r.fetch(); r.fulfill({ response: res, json: { ...(await res.json()), nightModeEnabled: true } }) }) },
  'set-sleep': async () => {},
  'set-devices': async () => {},
  'set-maintenance': async () => {},
  'set-mono': async () => {},
  'set-keyboard': async () => {},
  'set-system': async () => {},
  // The simulator can't read plugin settings (no keyring): fake Visualizer's values.
  'set-plugin': async (page) => { await page.route('**/api/v1/plugins/visualizer.reaplugin/settings', (r) => r.fulfill({ json: { Username: 'jo@example.com', Password: { isSet: true }, AutoUpload: true, LengthThreshold: 5 } })) },
  'set-plugin-failed': async () => {},
  'set-connect': async () => {},
  'set-schedule-add': async () => {},
  'set-brewing-1024x600': async () => {},
  'set-keyboard-long': async (page) => {
    const longOne = { ...visible[0], profile: { ...visible[0].profile, title: 'Supercalifragilisticexpialidociousprofilenamewithoutanyspaces' } }
    await page.route('**/api/v1/profiles?includeHidden=true', async (route) => { const res = await route.fetch(); const list = await res.json(); await route.fulfill({ response: res, json: [longOne, ...list.filter((p) => p.id !== longOne.id)] }) })
    await page.route('**/api/v1/store/mono/keyboard', (route) => route.fulfill({ json: { enabled: true, actions: { espresso: 'e', hotWater: 'w', steam: 's', flush: 'f', stop: ' ', sleep: 'p' }, profiles: { '1': longOne.id, '2': visible[1].id } } }))
  },
}

const QUERY = {}
const WAIT = { 'live-long-shot': 62_000, 'live-many': 12_000, 'done-many-early': 10_500, 'done-many-end': 21_000, 'live-mid-1024x600': 12_000, 'live-mid-1280x800': 12_000, 'live-mid-1920x1200': 12_000, 'done-1024x600': 12_500, 'live-early': 4_000, 'live-mid': 16_000, 'live-long-names': 16_000, 'done': 24_500, 'done-notes': 24_500 }

const openLibrary = (p) => p.getByRole('button', { name: 'All profiles' }).click()
const openFavs = async (p) => { await p.getByRole('button', { name: 'All profiles' }).click(); await p.getByRole('button', { name: 'MANAGE FAVOURITES' }).click() }
const openEditor = async (p) => { await p.getByRole('button', { name: 'All profiles' }).click(); await p.locator('.lib-row[aria-current="true"]').click(); await p.getByRole('button', { name: 'EDIT A COPY' }).click(); await p.waitForTimeout(300) }
const openSettings = async (p, section) => { await p.getByRole('button', { name: 'Settings' }).click(); if (section) await p.getByRole('button', { name: section, exact: true }).click(); await p.waitForTimeout(500) }
const ACTIONS = {
  'banner-link-library': (p) => p.getByRole('button', { name: 'All profiles' }).click().then(() => p.waitForTimeout(1600)),
  'hist': (p) => p.getByRole('button', { name: 'History' }).click().then(() => p.waitForTimeout(1200)),
  'hist-1024x600': (p) => p.getByRole('button', { name: 'History' }).click().then(() => p.waitForTimeout(1200)),
  'hist-long': (p) => p.getByRole('button', { name: 'History' }).click().then(() => p.waitForTimeout(1200)),
  'hist-empty': (p) => p.getByRole('button', { name: 'History' }).click().then(() => p.waitForTimeout(800)),
  'hist-search-empty': async (p) => { await p.getByRole('button', { name: 'History' }).click(); await p.getByLabel('Search shots').fill('zzzz nothing'); await p.waitForTimeout(1200) },
  'set-brewing': (p) => openSettings(p),
  'set-brewing-1024x600': (p) => openSettings(p),
  'set-sleep': (p) => openSettings(p, 'Sleep & display'),
  'set-devices': (p) => openSettings(p, 'Devices & water'),
  'set-maintenance': (p) => openSettings(p, 'Maintenance'),
  'set-mono': (p) => openSettings(p, 'Look & sound'),
  'set-keyboard': (p) => openSettings(p, 'Keyboard'),
  'set-keyboard-long': (p) => openSettings(p, 'Keyboard'),
  'set-system': (p) => openSettings(p, 'System'),
  'set-plugin': async (p) => { await openSettings(p, 'System'); await p.getByRole('button', { name: 'Visualizer upload settings' }).click(); await p.getByRole('switch', { name: 'Upload shots automatically' }).waitFor() },
  'set-plugin-failed': async (p) => { await openSettings(p, 'System'); await p.getByRole('button', { name: 'Visualizer upload settings' }).click(); await p.getByRole('alert').waitFor() },
  'set-machine': (p) => openSettings(p, 'Machine'),
  'set-machine-1024x600': (p) => openSettings(p, 'Machine'),
  'set-sleep-night': async (p) => { await openSettings(p, 'Sleep & display'); await p.locator('.set-cards').evaluate((e) => e.scrollTo(0, 9999)) },
  'set-connect': async (p) => { await openSettings(p, 'Devices & water'); await p.getByRole('button', { name: 'Connect a scale' }).click() },
  'set-schedule-add': async (p) => { await openSettings(p, 'Sleep & display'); await p.getByRole('button', { name: 'Add a wake time' }).click() },
  'editor': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-4').click() },
  'editor-many': (p) => openEditor(p),
  'editor-many-end': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-14').click(); await p.waitForTimeout(600) },
  'editor-1024x600': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-4').click() },
  'editor-value': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-4').click(); await p.getByTestId('ed-field-limit').click() },
  'editor-unsaved': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-6').click(); await p.getByRole('group', { name: 'TRANSITION' }).getByRole('button', { name: 'FAST' }).click(); await p.getByRole('button', { name: 'Back' }).click() },
  'editor-long-names': async (p) => { await openEditor(p); await p.getByTestId('ed-stage-4').click() },
  'favs': openFavs,
  'favs-drag': async (p) => {
    await openFavs(p)
    const card = (await p.locator('.fav-card').nth(1).boundingBox()); const slot = (await p.locator('[data-slot="1"]').boundingBox())
    await p.mouse.move(card.x + 60, card.y + 40); await p.mouse.down(); await p.waitForTimeout(400)
    await p.mouse.move(slot.x + 80, slot.y + 80, { steps: 12 })
  },
  'favs-detail': async (p) => { await openFavs(p); await p.locator('.fav-card').nth(2).click() },
  'library': openLibrary,
  'library-long-names': openLibrary,
  'library-empty-search': async (p) => { await openLibrary(p); await p.getByLabel('Search profiles').fill('zzzz no such profile') },
  'library-delete': async (p) => { await openLibrary(p); await p.getByRole('button', { name: 'MINE', exact: false }).first().click(); await p.locator('.lib-row').first().click(); await p.getByRole('button', { name: 'DELETE' }).click() },
  'done-notes': (p) => p.getByTestId('rate-tile').click(),
  'sheet-temp': (p) => p.getByTestId('value-temp').click(),
  'home-detail': (p) => p.getByTestId('main-card').click(),
  'sheet-long-name': (p) => p.getByTestId('value-yield').click(),
  'sheet-dose': (p) => p.getByTestId('value-dose').click(),
  'sheet-yield': async (p) => { await p.getByTestId('value-yield').click(); await p.getByTestId('tab-espressoYield').click() },
  'sheet-yield-allonge': async (p) => { await p.getByTestId('value-yield').click(); await p.getByTestId('tab-espressoYield').click() },
  'sheet-time': async (p) => { await p.getByTestId('value-time').click(); await p.getByTestId('tab-steamMax').click() },
  'sheet-steam-off': async (p) => { await p.getByTestId('value-temp').click(); await p.getByTestId('tab-steamTemp').click(); await p.getByRole('button', { name: 'OFF', exact: true }).click() },
}

const filter = process.argv[2] ?? ''
const browser = await chromium.launch()
const problems = []
for (const [name, arrange] of Object.entries(STATES)) {
  if (!name.includes(filter)) continue
  // A name ending in WxH is captured at that viewport; everything else at the 1194 × 834 design size.
  const [, vw, vh] = SIZE ?? name.match(/(\d+)x(\d+)$/) ?? [null, 1194, 834]
  const page = await browser.newPage({ viewport: { width: Number(vw), height: Number(vh) } })
  page.on('pageerror', (e) => !e.message.includes('already in CLOSING or CLOSED') && problems.push(`${name}: ${e.message}`))
  // The faked streams can still be sending while a page closes; that message comes from this harness.
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('already in CLOSING or CLOSED') && problems.push(`${name}: ${m.text()}`))
  page.on('request', (r) => { if (r.url().startsWith(API) && r.method() !== 'GET' && !r.url().endsWith('/machine/heartbeat')) problems.push(`${name}: wrote ${r.method()} ${r.url()}`) })
  await arrange(page)
  await page.goto(BASE + (QUERY[name] ?? ''))
  await page.waitForTimeout(WAIT[name] ?? 1_800)
  if (ACTIONS[name]) { await ACTIONS[name](page); await page.waitForTimeout(400) }
  await page.screenshot({ path: `${OUT}${name}.png` })
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close({ runBeforeUnload: false })
  console.log(`${OUT}${name}.png`)
}
await browser.close()
if (problems.length) { console.log('\nPROBLEMS\n' + problems.join('\n')); process.exit(1) }
process.exit(0) // synthetic stream timers must not keep the process alive
