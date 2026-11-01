import type { Page, WebSocketRoute } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { expect, test } from './fixtures'

const ready = async (page: Page) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
}
const banner = (page: Page) => page.getByTestId('connection-banner')

// Every Decaid WebSocket goes through here, so a test can cut the link and bring it back.
async function cuttableLink(page: Page) {
  let cut = false
  const open = new Set<WebSocketRoute>()
  await page.routeWebSocket(/:8080\/ws\//, (ws) => {
    if (cut) return ws.close()
    ws.connectToServer()
    open.add(ws)
    ws.onClose(() => open.delete(ws))
  })
  return {
    cut: () => { cut = true; for (const ws of open) ws.close() },
    restore: () => { cut = false },
  }
}

test.describe('Global', () => {
  test('GLB-02 Decaid unreachable at start, then recovers by itself', async ({ page }) => {
    const link = await cuttableLink(page)
    link.cut()
    await page.goto('/')
    await expect(banner(page)).toHaveText('CAN’T REACH DECAID · RECONNECTING…')
    await expect(page.getByTestId('thermal')).toHaveText('NO LINK')
    await expect(page.getByRole('button', { name: 'BREW' })).toBeDisabled()
    link.restore()
    await expect(banner(page)).toBeHidden({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  })

  test('GLB-03 link drops mid-use: banner, Brew disabled, recovers and re-reads', async ({ page }) => {
    const link = await cuttableLink(page)
    await ready(page)
    await page.getByRole('button', { name: 'All profiles' }).click()
    link.cut()
    await expect(banner(page)).toBeVisible()
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeDisabled()
    await expect(page.getByTestId('weight')).toHaveText('--')
    link.restore()
    await expect(banner(page)).toBeHidden({ timeout: 15_000 })
    await expect(page.getByTestId('weight')).toHaveText(/^-?\d+\.\d$/)
  })

  test('GLB-03 a blip shorter than the grace period shows no banner', async ({ page }) => {
    const link = await cuttableLink(page)
    await ready(page)
    link.cut()
    link.restore()
    await page.waitForTimeout(400)
    await expect(banner(page)).toBeHidden()
    await page.waitForTimeout(1_500)
    await expect(banner(page)).toBeHidden()
  })

  test('GLB-15 reconnecting after Decaid was away shows the real state, not a stale running one', async ({ page }) => {
    const link = await cuttableLink(page)
    await ready(page)
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(page.getByTestId('run-modal')).toBeVisible()
    link.cut()
    await decaid('PUT', '/api/v1/machine/state/idle') // stopped while Mono couldn't see it
    await expect(banner(page)).toBeVisible()
    link.restore()
    await expect(banner(page)).toBeHidden({ timeout: 15_000 })
    await expect(page.getByTestId('run-modal')).toBeHidden()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  })

  test('GLB-04 machine disconnects: banner and start buttons disabled; reconnect restores', async ({ page }) => {
    await ready(page)
    await decaid('POST', '/api/v1/debug/machine/disconnect')
    await expect(banner(page)).toHaveText('THE MACHINE ISN’T CONNECTED', { timeout: 10_000 })
    for (const name of ['BREW', 'STEAM', 'WATER', 'FLUSH']) await expect(page.getByRole('button', { name })).toBeDisabled()
    await decaid('GET', '/api/v1/devices/scan?connect=true')
    await expect(banner(page)).toBeHidden({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  })

  test('GLB-05 scale disconnects and comes back: weight and a word about it', async ({ page }) => {
    await ready(page)
    await decaid('POST', '/api/v1/debug/scale/disconnect')
    await expect(page.getByText('Scale disconnected')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('weight')).toHaveText('--')
    await expect(banner(page)).toBeHidden()
    await decaid('GET', '/api/v1/devices/scan?connect=true')
    await expect(page.getByText('Scale connected')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('weight')).toHaveText(/^-?\d+\.\d$/)
  })

  test('GLB-06 a stalled scale is shown as no reading', async ({ page }) => {
    await ready(page)
    await expect(page.getByTestId('weight')).toHaveText(/^-?\d+\.\d$/)
    await decaid('POST', '/api/v1/debug/scale/stall')
    try {
      await expect(page.getByTestId('weight')).toHaveText('--', { timeout: 6_000 })
    } finally {
      await decaid('POST', '/api/v1/debug/scale/resume')
    }
    await expect(page.getByTestId('weight')).toHaveText(/^-?\d+\.\d$/, { timeout: 6_000 })
  })

  test('GLB-07 the machine starting from outside Mono opens the right screen', async ({ page }) => {
    await ready(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(page.getByTestId('run-modal')).toHaveAttribute('data-kind', 'steam')
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(page.getByTestId('run-modal')).toBeHidden({ timeout: 10_000 })
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await decaid('PUT', '/api/v1/machine/state/espresso')
    await expect(page.getByTestId('live-shot')).toBeVisible()
    await decaid('PUT', '/api/v1/machine/state/idle')
  })

  test('GLB-08 KEY-11 group-head-controller machine: no start tiles, start keys say so, the group head opens Live shot, Stop works', async ({ page }) => {
    await page.route('**/api/v1/machine/info', (r) => r.fulfill({ json: { model: 'DE1Pro', GHC: true } }))
    const starts: string[] = []
    page.on('request', (r) => { if (/machine\/state\/(espresso|steam|hotWater|flush)$/.test(r.url())) starts.push(r.url()) })
    await page.goto('/')
    await expect(page.getByTestId('main-card')).toBeVisible()
    for (const name of ['BREW', 'STEAM', 'WATER', 'FLUSH']) await expect(page.getByRole('button', { name })).toHaveCount(0) // no start tiles at all
    await page.locator('body').click({ position: { x: 600, y: 20 } })
    await page.keyboard.press('e')
    await expect(page.getByRole('alert')).toHaveText('Start on the group head.')
    expect(starts).toEqual([])
    expect(await machineState()).toBe('idle')
    // Started on the machine (here: through the API, as the group head would).
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await decaid('PUT', '/api/v1/machine/state/espresso')
    await expect(page.getByTestId('live-shot')).toBeVisible()
    await page.keyboard.press(' ')
    await waitForMachineState('idle')
  })

  test('GLB-10 maintenance shows a machine message with Stop', async ({ page }) => {
    await ready(page)
    await decaid('PUT', '/api/v1/machine/state/cleaning').catch(() => undefined)
    test.skip((await machineState()) !== 'cleaning', 'the simulator would not start cleaning from the API')
    await expect(page.getByTestId('machine-message')).toHaveAttribute('data-kind', 'cleaning')
    await page.getByTestId('machine-message').getByRole('button', { name: 'STOP' }).click()
    await waitForMachineState('idle')
    await expect(page.getByTestId('machine-message')).toBeHidden()
  })

  test('GLB-10 a machine error shows what to do, and can be put away', async ({ page }) => {
    await page.routeWebSocket(/:8080\/ws\/v1\/machine\/snapshot/, (ws) => {
      const server = ws.connectToServer()
      server.onMessage((m) => ws.send(JSON.stringify({ ...JSON.parse(String(m)), state: { state: 'error', substate: 'idle' } })))
    })
    await page.goto('/')
    const msg = page.getByTestId('machine-message')
    await expect(msg).toHaveAttribute('data-kind', 'error')
    await expect(msg).toContainText('Switch it off and on at the back')
    await msg.getByRole('button', { name: 'GOT IT' }).click()
    await expect(msg).toBeHidden()
  })

  test('GLB-11 a touch sends one heartbeat; no more within 30 s; none while asleep', async ({ page }) => {
    const beats: number[] = []
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/machine/heartbeat')) beats.push(Date.now()) })
    await ready(page)
    await page.waitForTimeout(1_000)
    expect(beats).toHaveLength(0) // opening Mono alone sends nothing
    await page.getByTestId('thermal').click()
    await expect.poll(() => beats.length, { timeout: 8_000 }).toBe(1)
    await page.getByTestId('thermal').click()
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(500)
    expect(beats).toHaveLength(1)
  })

  test('GLB-11 no heartbeat from touching the sleep screen', async ({ page }) => {
    const beats: string[] = []
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/machine/heartbeat')) beats.push(r.url()) })
    await decaid('PUT', '/api/v1/machine/state/sleeping')
    await page.goto('/')
    await expect(page.getByTestId('sleep')).toBeVisible()
    await page.mouse.click(600, 400)
    await page.waitForTimeout(800)
    expect(beats).toHaveLength(0)
  })

  test('GLB-13 a failed write shows a plain error and the control keeps the real value', async ({ page }) => {
    await page.route('**/api/v1/settings', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, json: { error: 'StateError: Bad state: settings locked' } }) : r.fallback()))
    await ready(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const sw = page.getByRole('switch', { name: 'Require a scale to brew' })
    const before = await sw.getAttribute('aria-checked')
    await sw.click()
    await expect(page.getByRole('alert')).toHaveText("Decaid couldn't do that. Try again.")
    await expect(sw).toHaveAttribute('aria-checked', before!)
  })

  test('GLB-14 a slow start: Brew shows pending and a second tap sends nothing more', async ({ page }) => {
    const starts: string[] = []
    await page.route('**/api/v1/machine/state/espresso', async (r) => { starts.push(r.request().url()); await new Promise((res) => setTimeout(res, 2_500)); await r.fallback() })
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await ready(page)
    await page.getByRole('button', { name: 'BREW' }).click()
    await page.getByRole('button', { name: 'BREW' }).click({ timeout: 1_000 }).catch(() => undefined)
    await waitForMachineState('espresso', 10_000)
    expect(starts).toHaveLength(1)
    await decaid('PUT', '/api/v1/machine/state/idle')
  })

  test('GLB-17 inside Decaid’s app, Exit to Decaid calls the host', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { decentApp: object }).decentApp = { exitToDashboard: () => { (window as unknown as { exited: boolean }).exited = true } } })
    await ready(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'System', exact: true }).click()
    await page.getByRole('button', { name: 'Exit to Decaid' }).click()
    expect(await page.evaluate(() => (window as unknown as { exited?: boolean }).exited)).toBe(true)
  })

  test('GLB-17 outside Decaid’s app there is no Exit button', async ({ page }) => {
    await ready(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'System', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Exit to Decaid' })).toHaveCount(0)
  })

  test('GLB-18 the chart accent recolours flow everywhere', async ({ page }) => {
    await decaid('POST', '/api/v1/store/mono/prefs', { accent: 'teal' })
    await ready(page)
    const flowFill = () => page.locator('[data-series="flow"] circle').first().evaluate((c) => getComputedStyle(c).fill)
    await expect.poll(flowFill).toBe('rgb(61, 127, 122)')
    await page.getByRole('button', { name: 'All profiles' }).click()
    await expect.poll(flowFill).toBe('rgb(61, 127, 122)')
  })

  test('GLB-19 °F converts temperatures shown and entered', async ({ page }) => {
    const wf = await decaid<{ profile: { steps: { temperature: number }[] } }>('GET', '/api/v1/workflow')
    const c = wf.profile.steps[0].temperature
    await decaid('POST', '/api/v1/store/mono/prefs', { units: 'f' })
    await ready(page)
    await expect(page.getByTestId('value-temp')).toContainText('°F')
    await expect(page.getByTestId('value-temp')).toContainText(String(Math.round(c * 9 / 5 + 32)))
    await page.getByTestId('value-temp').click()
    await expect(page.getByRole('dialog').getByRole('slider').first()).toHaveAttribute('aria-valuenow', /^\d+(\.\d+)?$/)
    expect(Number(await page.getByRole('dialog').getByRole('slider').first().getAttribute('aria-valuenow'))).toBeGreaterThan(150)
  })

  test('GLB-20 12-hour clock', async ({ page }) => {
    await decaid('POST', '/api/v1/store/mono/prefs', { clock: '12' })
    await ready(page)
    const text = await page.getByTestId('home-clock').textContent()
    expect(Number(text!.split(':')[0])).toBeLessThanOrEqual(12)
    await decaid('POST', '/api/v1/store/mono/prefs', { clock: '24' })
    await page.reload()
    const h = new Date().getHours()
    await expect(page.getByTestId('home-clock')).toHaveText(new RegExp(`^${String(h).padStart(2, '0')}:\\d\\d$`))
  })

  test('GLB-22 fonts are bundled: no font requests leave the device', async ({ page }) => {
    const external: string[] = []
    page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) external.push(r.url()) })
    await ready(page)
    await page.evaluate(() => document.fonts.ready)
    expect(external).toEqual([])
    expect(await page.evaluate(() => ['Doto', 'Newsreader', 'IBM Plex Mono'].map((f) => document.fonts.check(`16px "${f}"`)))).toEqual([true, true, true])
  })
})
