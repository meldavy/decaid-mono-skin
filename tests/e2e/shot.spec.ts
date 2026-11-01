import type { Page } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { expect, loadByApi, setFavourites, test, type ProfileRecord } from './fixtures'

type Shot = { id: string; annotations?: { enjoyment?: number | null; espressoNotes?: string | null }; workflow?: { context?: { grinderSetting?: string | null } } }
const live = (page: Page) => page.getByTestId('live-shot')
const done = (page: Page) => page.getByTestId('shot-done')
const num = async (page: Page, id: string) => Number(await page.getByTestId(id).textContent())

let adaptive: ProfileRecord

async function brew(page: Page, { yieldG = 200 } = {}) {
  await decaid('PUT', '/api/v1/workflow', { context: { targetDoseWeight: 18, targetYield: yieldG } })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  await page.getByRole('button', { name: 'BREW' }).click()
  await expect(live(page)).toBeVisible()
}

// Let the shot really run (Decaid doesn't save a shot stopped almost at once), then stop it.
async function finish(page: Page) {
  await expect.poll(() => num(page, 'live-time'), { timeout: 15_000 }).toBeGreaterThan(3)
  await decaid('PUT', '/api/v1/machine/state/idle')
  await expect(done(page)).toBeVisible({ timeout: 15_000 })
}

async function shotId(page: Page) {
  const id = await done(page).getAttribute('data-shot-id')
  expect(id, 'the result knows its shot id').toBeTruthy()
  return id!
}

// Adaptive v3's long pre-infusion keeps the mock scale near 0 g for a while; weight tests use a plain profile.
async function quickProfile(profiles: ProfileRecord[]) {
  await loadByApi(profiles.find((p) => p.profile.title === 'Default') ?? profiles[0])
}

test.describe('Live shot', () => {
  test.beforeEach(async ({ profiles }) => {
    adaptive = profiles.find((p) => p.profile.title === 'Adaptive v3') ?? profiles[0]
    await setFavourites(profiles.slice(0, 5).map((p) => p.id))
    await loadByApi(adaptive)
  })

  test('LIVE-01 opens when espresso starts outside Mono', async ({ page }) => {
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
    await decaid('PUT', '/api/v1/machine/state/espresso')
    await expect(live(page)).toBeVisible()
  })

  test('HOME-07 Brew starts espresso and opens the live shot', async ({ page }) => {
    await brew(page)
    expect(await machineState()).toBe('espresso')
  })

  test('LIVE-02 time and weight run live at the same size; goal and yield target shown', async ({ page, profiles }) => {
    await quickProfile(profiles)
    await brew(page)
    await expect.poll(() => num(page, 'live-time')).toBeGreaterThan(1.5)
    await expect.poll(() => num(page, 'live-weight')).toBeGreaterThan(1)
    const size = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).fontSize)
    expect(await size('live-time')).toBe(await size('live-weight'))
    await expect(page.getByTestId('time-label')).toHaveText('TIME S · GOAL 25')
    await expect(live(page)).toContainText('200.0 G')
    await expect(page.getByTestId('yield-pct')).toHaveText(/^\d+% OF YIELD$/)
  })

  test('LIVE-03 stage timeline follows the machine: names from the profile, current stage lit', async ({ page }) => {
    await brew(page)
    const steps = adaptive.profile as unknown as { steps: { name: string }[] }
    await expect(page.getByTestId('stages').locator('li')).toHaveCount(steps.steps.length)
    for (const [i, st] of steps.steps.entries()) await expect(page.getByTestId(`stage-${i}`)).toContainText(st.name)
    await expect(page.getByTestId('stage-0')).toHaveAttribute('aria-current', 'step')
    await expect(page.getByTestId('stage-count')).toHaveText(`STAGE 1 OF ${steps.steps.length}`)
    await expect(page.locator('[aria-current="step"]')).not.toHaveAttribute('data-testid', 'stage-0', { timeout: 10_000 })
  })

  test('LIVE-04 the chart fills in live over the ghosted plan', async ({ page }) => {
    await brew(page)
    const chart = live(page).getByTestId('dot-chart')
    await expect.poll(() => chart.locator('[data-series="pressure"] circle').count()).toBeGreaterThan(8)
    expect(await chart.locator('[data-series="plan"] circle').count()).toBeGreaterThan(0)
  })

  test('LIVE-05 Stop shows pending, the machine stops, then Shot complete', async ({ page }) => {
    await brew(page)
    await page.route('**/machine/state/idle', async (route) => { await new Promise((r) => setTimeout(r, 600)); await route.continue() })
    await page.getByRole('button', { name: 'STOP' }).click()
    await expect(page.getByRole('button', { name: /STOPPING/ })).toBeVisible()
    await waitForMachineState('idle')
    await expect(done(page)).toBeVisible({ timeout: 15_000 })
  })

  test('LIVE-06 Next stage advances the machine to the next stage', async ({ page }) => {
    await brew(page)
    const frame = async () => (await decaid<{ profileFrame: number }>('GET', '/api/v1/machine/state')).profileFrame
    const before = await frame()
    await page.getByRole('button', { name: 'NEXT' }).click()
    await expect.poll(frame).toBeGreaterThan(before)
  })

  test('LIVE-07 stops at the target weight; Shot complete says why', async ({ page, profiles }) => {
    await quickProfile(profiles)
    await brew(page, { yieldG: 20 })
    await expect(done(page)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('stage-count')).toContainText('ENDED ON WEIGHT')
  })

  test('LIVE-09 losing the scale mid-shot: weight shows --, the shot goes on, Stop works', async ({ page, profiles }) => {
    await quickProfile(profiles)
    await brew(page)
    await expect.poll(() => num(page, 'live-weight')).toBeGreaterThan(0)
    await decaid('POST', '/api/v1/debug/scale/disconnect')
    await expect(page.getByTestId('live-weight')).toHaveText('--', { timeout: 10_000 })
    expect(await machineState()).toBe('espresso')
    await page.getByRole('button', { name: 'STOP' }).click()
    await waitForMachineState('idle')
  })

  test('LIVE-11 losing the link mid-shot says NO LINK and keeps the recorded data', async ({ page }) => {
    const link = { down: false }
    await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => {
      if (link.down) return ws.close()
      const server = ws.connectToServer()
      const timer = setInterval(() => link.down && ws.close(), 50)
      ws.onClose(() => { clearInterval(timer); server.close() })
    })
    await brew(page)
    const chart = live(page).getByTestId('dot-chart')
    await expect.poll(() => chart.locator('[data-series="pressure"] circle').count()).toBeGreaterThan(8)
    link.down = true
    await expect(page.getByTestId('live-status')).toHaveText('NO LINK')
    expect(await chart.locator('[data-series="pressure"] circle').count()).toBeGreaterThan(8)
    link.down = false
    await expect(page.getByTestId('live-status')).not.toHaveText('NO LINK')
  })

  test('LIVE-12 Mono sends no tare during a shot; weight starts near zero', async ({ page }) => {
    const tares: string[] = []
    page.on('request', (r) => { if (r.url().includes('/tare')) tares.push(r.url()) })
    await brew(page)
    await expect.poll(() => num(page, 'live-weight')).toBeLessThan(3)
    await page.waitForTimeout(2_000)
    expect(tares).toEqual([])
  })

  test('LIVE-14 the stage bar follows the exit set to finish first', async ({ page }) => {
    // Adaptive v3's Fill stage: flow 8 for up to 12 s, or until pressure is over 3 bar.
    let pressure = 0.5
    let rising = true
    await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => {
      const t = setInterval(() => {
        if (rising) pressure += 0.1
        ws.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: 'espresso', substate: 'pouring' }, flow: 8, pressure, targetFlow: 8, targetPressure: 0, mixTemperature: 92, groupTemperature: 92, targetMixTemperature: 93, targetGroupTemperature: 93, profileFrame: 1, steamTemperature: 150 }))
      }, 100)
      ws.onClose(() => clearInterval(t))
    })
    await page.routeWebSocket(/\/ws\/v1\/machine\/shotState/, (ws) => ws.send(JSON.stringify({ event: 'state', timestamp: '', shotId: 'x', state: 'pouring', machineState: 'espresso', machineSubstate: 'pouring', profileFrame: 1, scaleConnected: true, scaleLost: false, decision: null })))
    await page.goto('/')
    const bar = page.getByTestId('stage-progress')
    await expect(bar).toHaveAttribute('data-kind', 'pressure')
    await expect(bar).toHaveText(/→ 3\.0 BAR$/)
    rising = false // pressure stalls: time becomes the soonest exit
    await expect(bar).toHaveAttribute('data-kind', 'time', { timeout: 5_000 })
    await expect(bar).toHaveText(/S OF 12$/)
  })

  // A 15-stage profile, with the machine's stage set by the test. `end()` finishes the shot where it is.
  async function manyStages(page: Page, profiles: ProfileRecord[]) {
    const weber = profiles.find((p) => p.profile.title === 'Cleaning/Weber Spring Clean')
    test.skip(!weber, 'needs the Weber Spring Clean built-in')
    const ctl = { frame: 0, ended: false, end: () => {} }
    await page.route('**/api/v1/workflow', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch(); const wf = await res.json()
      await route.fulfill({ response: res, json: { ...wf, profile: weber!.profile } })
    })
    await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => {
      const t = setInterval(() => ws.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: ctl.ended ? 'idle' : 'espresso', substate: ctl.ended ? 'idle' : 'pouring' }, flow: 4, pressure: 2, targetFlow: 4, targetPressure: 0, mixTemperature: 92, groupTemperature: 92, targetMixTemperature: 93, targetGroupTemperature: 93, profileFrame: ctl.frame, steamTemperature: 150 })), 100)
      ws.onClose(() => clearInterval(t))
    })
    await page.routeWebSocket(/\/ws\/v1\/machine\/shotState/, (ws) => {
      const base = { timestamp: '', shotId: 'many', machineState: 'espresso', machineSubstate: 'pouring', profileFrame: 0, scaleConnected: true, scaleLost: false }
      ws.send(JSON.stringify({ ...base, event: 'state', state: 'pouring', decision: null }))
      ctl.end = () => {
        ctl.ended = true
        ws.send(JSON.stringify({ ...base, profileFrame: ctl.frame, event: 'decision', state: 'stopping', decision: { kind: 'stop', reason: 'targetVolume' } }))
        ws.send(JSON.stringify({ ...base, profileFrame: ctl.frame, event: 'state', state: 'finished', decision: null }))
      }
    })
    await page.route('**/api/v1/shots/many', (route) => route.fulfill({ json: { id: 'many', timestamp: '', annotations: null } }))
    await page.goto('/')
    await expect(live(page)).toBeVisible()
    await expect(page.getByTestId('stages').locator('li')).toHaveCount(15)
    return ctl
  }
  const strip = (page: Page) => page.getByTestId('stages')
  const inView = async (page: Page, i: number) => {
    const [s, li] = [(await strip(page).boundingBox())!, (await page.getByTestId(`stage-${i}`).boundingBox())!]
    return li.x >= s.x - 1 && li.x + li.width <= s.x + s.width + 1
  }

  test('LIVE-15 many stages keep room for their names; the row follows the shot and can\'t be dragged', async ({ page, profiles }) => {
    const ctl = await manyStages(page, profiles)
    for (const li of await strip(page).locator('li').all()) expect((await li.boundingBox())!.width).toBeGreaterThanOrEqual(135.5)
    expect(await strip(page).evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'hidden')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await inView(page, 0)).toBe(true)
    ctl.frame = 9
    await expect(page.getByTestId('stage-9')).toHaveAttribute('aria-current', 'step')
    await expect.poll(() => inView(page, 9)).toBe(true)
    ctl.frame = 14
    await expect.poll(() => inView(page, 14)).toBe(true)
  })

  test('DONE-10 stopped in the first of many stages: the result opens at the front, and scrolls', async ({ page, profiles }) => {
    const ctl = await manyStages(page, profiles)
    await page.waitForTimeout(1_500)
    ctl.end()
    await expect(done(page)).toBeVisible({ timeout: 10_000 })
    expect(await strip(page).evaluate((el) => el.scrollLeft)).toBe(0)
    expect(await inView(page, 0)).toBe(true)
    expect(await strip(page).evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto')
    await strip(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    expect(await inView(page, 14)).toBe(true)
  })

  test('DONE-10 run through every stage: the result opens at the end', async ({ page, profiles }) => {
    const ctl = await manyStages(page, profiles)
    for (const f of [3, 8, 14]) { ctl.frame = f; await page.waitForTimeout(500) }
    ctl.end()
    await expect(done(page)).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => strip(page).evaluate((el) => Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth) <= 1)).toBe(true)
    expect(await inView(page, 14)).toBe(true)
  })

  test('the live shot buttons match Home: Next = Steam tile, Stop = Brew tile, same spacing', async ({ page }) => {
    await page.goto('/')
    const steam = (await page.getByRole('button', { name: 'STEAM' }).boundingBox())!
    const brewBox = (await page.getByRole('button', { name: 'BREW' }).boundingBox())!
    await brew(page)
    const next = (await page.getByRole('button', { name: 'NEXT' }).boundingBox())!
    const stop = (await page.getByRole('button', { name: 'STOP' }).boundingBox())!
    expect([next.width, next.height]).toEqual([steam.width, steam.height])
    expect([stop.width, stop.height]).toEqual([brewBox.width, brewBox.height])
    expect(stop.x - (next.x + next.width)).toBe(12)
    // …and in the same place: page padding is one token for every screen.
    expect(stop.x + stop.width).toBe(brewBox.x + brewBox.width)
    expect(stop.y + stop.height).toBe(brewBox.y + brewBox.height)
  })

  test('LIVE-13 no way out mid-shot except Stop; Esc does nothing', async ({ page }) => {
    await brew(page)
    const names = await live(page).getByRole('button').allTextContents()
    expect(names.map((n) => n.trim())).toEqual(['NEXT', 'STOP'])
    await page.keyboard.press('Escape')
    await expect(live(page)).toBeVisible()
    expect(await machineState()).toBe('espresso')
  })

  test('GLB-26 long stage and profile names stay on one line in the live shot', async ({ page }) => {
    const p = adaptive.profile as unknown as { title: string; steps: { name: string }[] }
    const fake = { ...p, title: 'Pour over basket/Cold brew 22g in, 375ml out — extended slow bloom', steps: p.steps.map((s, i) => ({ ...s, name: i === 0 ? 'Supercalifragilisticexpialidociousstage' : `${s.name} with a much longer stage name` })) }
    await decaid('PUT', '/api/v1/workflow', { profile: fake })
    await brew(page)
    const lines = (el: Element) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    expect(await live(page).locator('.live-title').evaluate(lines)).toBe(1)
    for (const name of await live(page).locator('.stage-name').all()) {
      expect(await name.evaluate(lines)).toBeLessThanOrEqual(2)
      expect((await name.boundingBox())!.width).toBeGreaterThanOrEqual(60)
    }
    expect((await live(page).locator('.live-header').boundingBox())!.height).toBe(196)
  })
})

test.describe('Shot complete', () => {
  test.beforeEach(async ({ profiles }) => {
    adaptive = profiles.find((p) => p.profile.title === 'Adaptive v3') ?? profiles[0]
    await setFavourites(profiles.slice(0, 5).map((p) => p.id))
    await loadByApi(adaptive)
  })

  test('DONE-01 shows the frozen chart, time, weight, ratio, peak, average flow and stop reason', async ({ page }) => {
    await brew(page)
    await page.waitForTimeout(3_000)
    await page.getByRole('button', { name: 'STOP' }).click()
    await expect(done(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('live-status')).toHaveText('DONE')
    await expect(page.getByTestId('stage-count')).toContainText(/^STOPPED · /)
    await expect(page.getByTestId('yield-pct')).toHaveText(/OF 200\.0 G$/)
    await expect(page.getByTestId('ratio')).toHaveText(/^1:\d+\.\d$/)
    expect(await num(page, 'peak')).toBeGreaterThan(0)
    expect(await num(page, 'avg-flow')).toBeGreaterThan(0)
    const time = await num(page, 'live-time')
    await page.waitForTimeout(1_500)
    expect(await num(page, 'live-time')).toBe(time) // frozen
    expect(await done(page).getByTestId('dot-chart').locator('[data-series="plan"] circle').count()).toBeGreaterThan(0)
  })

  test('DONE-02 shows the time against the shot goal', async ({ page }) => {
    await brew(page)
    await finish(page)
    await expect(page.getByTestId('time-label')).toHaveText(/^TIME S · GOAL 25 · (−\d+\.\d|\+\d+\.\d|ON GOAL)$/)
  })

  test('DONE-03 Rate opens the sheet; the rating saves with Save; tapping the same pip clears it', async ({ page }) => {
    await brew(page)
    await finish(page)
    const id = await shotId(page)
    const enjoyment = async () => (await decaid<Shot>('GET', `/api/v1/shots/${id}`)).annotations?.enjoyment ?? null
    const sheet = page.getByRole('dialog', { name: 'Shot notes' })
    await page.getByTestId('rate-tile').click()
    await sheet.getByRole('button', { name: 'Rate 4 of 5' }).click()
    await expect(sheet.getByRole('group', { name: 'Rating, 4 of 5' })).toBeVisible()
    expect(await enjoyment()).toBeNull() // nothing is written before Save
    await sheet.getByRole('button', { name: 'SAVE' }).click()
    await expect.poll(enjoyment).toBe(8)
    await expect(page.getByTestId('rate-tile')).toHaveAccessibleName('Rate, rated 4 of 5')
    await page.getByTestId('rate-tile').click()
    await expect(sheet.getByRole('group', { name: 'Rating, 4 of 5' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Rate 4 of 5' }).click()
    await expect(sheet.getByRole('group', { name: 'Rating, 0 of 5' })).toBeVisible()
    await sheet.getByRole('button', { name: 'SAVE' }).click()
    await expect.poll(enjoyment).toBeNull()
    await expect(page.getByTestId('rate-tile')).toHaveAccessibleName('Rate')
  })

  test('DONE-04 notes and grind save to the shot; only what changed is sent', async ({ page }) => {
    await brew(page)
    await finish(page)
    const id = await shotId(page)
    const puts: Record<string, unknown>[] = []
    page.on('request', (r) => { if (r.url().includes('/api/v1/shots/') && r.method() === 'PUT') puts.push(JSON.parse(r.postData() ?? '{}')) })
    await page.getByTestId('rate-tile').click()
    await page.getByTestId('notes-input').fill('Sweet, a touch sour at the end.')
    await page.getByTestId('grind-input').fill('2.5')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByRole('dialog', { name: 'Shot notes' })).toBeHidden()
    const shot = await decaid<Shot>('GET', `/api/v1/shots/${id}`)
    expect(shot.annotations?.espressoNotes).toBe('Sweet, a touch sour at the end.')
    expect(shot.workflow?.context?.grinderSetting).toBe('2.5')
    await page.getByTestId('rate-tile').click()
    await expect(page.getByTestId('grind-input')).toHaveValue('2.5')
    await page.getByTestId('grind-input').fill('2.6')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByRole('dialog', { name: 'Shot notes' })).toBeHidden()
    expect(puts[1]).toEqual({ workflow: { context: { grinderSetting: '2.6' } } })
  })

  for (const how of ['Cancel', 'scrim', 'Esc', 'swipe'] as const) {
    test(`DONE-04 cancelling notes by ${how} writes nothing`, async ({ page }) => {
      await brew(page)
      await finish(page)
      const puts: string[] = []
      page.on('request', (r) => { if (r.url().includes('/api/v1/shots/') && r.method() === 'PUT') puts.push(r.url()) })
      await page.getByTestId('rate-tile').click()
      await page.getByTestId('notes-input').fill('not saved')
      if (how === 'Cancel') await page.getByRole('button', { name: 'CANCEL' }).click()
      if (how === 'scrim') await page.getByTestId('scrim').click({ position: { x: 600, y: 60 } })
      if (how === 'Esc') await page.keyboard.press('Escape')
      if (how === 'swipe') {
        const h = (await page.getByTestId('sheet-handle').boundingBox())!
        await page.mouse.move(h.x + h.width / 2, h.y + 10)
        await page.mouse.down()
        await page.mouse.move(h.x + h.width / 2, h.y + 200, { steps: 5 })
        await page.mouse.up()
      }
      await expect(page.getByRole('dialog', { name: 'Shot notes' })).toBeHidden()
      expect(puts).toEqual([])
    })
  }

  test('DONE-05 a failed note save keeps the text and says so', async ({ page }) => {
    await brew(page)
    await finish(page)
    await page.getByTestId('rate-tile').click()
    await page.route('**/api/v1/shots/*', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()))
    await page.getByTestId('notes-input').fill('Keep me')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByTestId('notes-status')).toHaveText("COULDN'T SAVE — YOUR TEXT IS STILL HERE")
    await expect(page.getByTestId('notes-input')).toHaveValue('Keep me')
  })

  test('DONE-06 Done returns Home and writes nothing', async ({ page }) => {
    await brew(page)
    await finish(page)
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes(':8080') && r.method() !== 'GET' && !r.url().endsWith('/machine/heartbeat')) writes.push(r.url()) })
    await page.getByRole('button', { name: 'DONE' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('DONE-07 a new shot starting on this screen replaces it with the live shot', async ({ page }) => {
    await brew(page)
    await finish(page)
    await decaid('PUT', '/api/v1/machine/state/espresso')
    await expect(live(page)).toBeVisible()
    await expect.poll(() => num(page, 'live-time')).toBeLessThan(5)
  })

  test('DONE-08 a shot stopped within a second still gives a valid result; unsaved shots can\'t be annotated', async ({ page }) => {
    await brew(page)
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(done(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('live-time')).toHaveText(/^\d+\.\d$/)
    await expect(page.getByRole('button', { name: 'DONE' })).toBeEnabled()
    await expect(page.getByText("This shot wasn't saved, so it can't be rated.")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('rate-tile')).toBeDisabled()
  })
})
