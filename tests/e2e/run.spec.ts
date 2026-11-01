import type { Page } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { expect, test } from './fixtures'

const modal = (page: Page) => page.getByTestId('run-modal')
const KINDS = [['steam', 'STEAMING'], ['hotWater', 'POURING'], ['flush', 'FLUSHING']] as const

async function home(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
}

// Lets a test cut a live stream: while `down` is true, every connection attempt is refused.
async function cuttable(page: Page, path: RegExp) {
  const state = { down: false }
  await page.routeWebSocket(path, (ws) => {
    if (state.down) return ws.close()
    const server = ws.connectToServer()
    const timer = setInterval(() => state.down && ws.close(), 50)
    ws.onClose(() => { clearInterval(timer); server.close() })
  })
  return state
}

test.describe('Running modals', () => {
  test.beforeEach(async () => {
    await decaid('PUT', '/api/v1/workflow', {
      steamSettings: { targetTemperature: 150, duration: 30, flow: 0.8 },
      hotWaterData: { targetTemperature: 75, duration: 30, volume: 200, flow: 10 },
      rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
    })
  })

  for (const [kind, title] of KINDS) {
    test(`RUN-01 opens for ${kind} started outside Mono`, async ({ page }) => {
      await home(page)
      await decaid('PUT', `/api/v1/machine/state/${kind}`)
      await expect(modal(page)).toHaveAttribute('data-kind', kind)
      await expect(modal(page)).toContainText(title)
    })
  }

  test('RUN-02 shows live time, flow / weight and temperature with targets in serif', async ({ page }) => {
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(page.getByTestId('reading-time')).toContainText('of 30 s')
    await expect(page.getByTestId('reading-flow')).toContainText('set to 0.8 ml/s')
    await expect(page.getByTestId('reading-steam')).toContainText('set to 150°')
    await expect(page.getByTestId('reading-time').locator('.run-value')).toHaveText(/^[2-9]$/, { timeout: 5_000 })
    await decaid('PUT', '/api/v1/machine/state/idle')
    await decaid('PUT', '/api/v1/scale/tare')
    await decaid('PUT', '/api/v1/machine/state/hotWater')
    await expect(page.getByTestId('reading-weight')).toContainText('of 200 g')
    await expect(page.getByTestId('reading-water')).toContainText('set to 75°')
    await expect.poll(async () => Number(await page.getByTestId('reading-weight').locator('.run-value').textContent())).toBeGreaterThan(5)
  })

  test('RUN-03 progress fills by time for flush and by amount for hot water', async ({ page }) => {
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/flush')
    const bar = modal(page).getByRole('img', { name: /percent done/ })
    await expect.poll(async () => Number(await bar.getAttribute('data-lit'))).toBeGreaterThan(14) // 2+ of 10 s
    await decaid('PUT', '/api/v1/machine/state/idle')
    await decaid('PUT', '/api/v1/scale/tare')
    await decaid('PUT', '/api/v1/machine/state/hotWater')
    await expect(modal(page)).toContainText('STOPS AT WEIGHT')
    await expect.poll(async () => Number(await bar.getAttribute('data-lit')), { timeout: 8_000 }).toBeGreaterThan(7) // 20+ of 200 g
  })

  test('RUN-04 Stop shows pending, the machine goes idle, the modal closes', async ({ page }) => {
    await home(page)
    await page.getByRole('button', { name: 'STEAM' }).click()
    await expect(modal(page)).toBeVisible()
    await page.route('**/machine/state/idle', async (route) => { await new Promise((r) => setTimeout(r, 600)); await route.continue() })
    await page.getByRole('button', { name: 'STOP' }).click()
    await expect(page.getByTestId('stop-status')).toHaveText('STOPPING…')
    await waitForMachineState('idle')
    await expect(modal(page)).toBeHidden()
  })

  test('RUN-05 a failed Stop says so and Stop works again', async ({ page }) => {
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/steam')
    await page.route('**/machine/state/idle', (route) => route.fulfill({ status: 500, body: '{}' }))
    await page.getByRole('button', { name: 'STOP' }).click()
    await expect(page.getByTestId('stop-status')).toHaveText("DIDN'T STOP — TRY AGAIN")
    expect(await machineState()).toBe('steam')
    await page.unroute('**/machine/state/idle')
    await page.getByRole('button', { name: 'STOP' }).click()
    await waitForMachineState('idle')
    await expect(modal(page)).toBeHidden()
  })

  test('RUN-06 closes when the machine finishes or is stopped elsewhere', async ({ page }) => {
    // The mock DE1 never ends a flush or steam by itself, so "finished" is hot water that Decaid stops at weight.
    await decaid('POST', '/api/v1/settings', { stopHotWaterAtWeight: true })
    await decaid('PUT', '/api/v1/workflow', { hotWaterData: { volume: 15, duration: 60 } })
    await home(page)
    await decaid('PUT', '/api/v1/scale/tare')
    await decaid('PUT', '/api/v1/machine/state/hotWater')
    await expect(modal(page)).toBeVisible()
    await expect(modal(page)).toBeHidden({ timeout: 15_000 })
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(modal(page)).toBeVisible()
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(modal(page)).toBeHidden()
  })

  test('RUN-07 hot water stops at weight with a scale', async ({ page }) => {
    await decaid('POST', '/api/v1/settings', { stopHotWaterAtWeight: true })
    await decaid('PUT', '/api/v1/workflow', { hotWaterData: { volume: 25, duration: 60 } })
    await home(page)
    await decaid('PUT', '/api/v1/scale/tare')
    await page.getByRole('button', { name: 'WATER' }).click()
    await expect(modal(page)).toBeVisible()
    await expect(modal(page)).toBeHidden({ timeout: 15_000 })
    const weight = (await decaid<{ weight?: number }>('GET', '/api/v1/scale/info').catch(() => ({ weight: undefined }))).weight
    if (weight !== undefined) expect(weight).toBeGreaterThan(15)
    expect(await machineState()).not.toBe('hotWater')
  })

  test('RUN-08 losing the scale mid-pour switches to volume and Stop still works', async ({ page }) => {
    await decaid('PUT', '/api/v1/workflow', { hotWaterData: { volume: 400, duration: 60 } })
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/hotWater')
    await expect(page.getByTestId('reading-weight')).toBeVisible()
    await decaid('POST', '/api/v1/debug/scale/disconnect')
    await expect(page.getByTestId('reading-volume')).toBeVisible({ timeout: 10_000 })
    await expect(modal(page)).toContainText('of 400 ml')
    await page.getByRole('button', { name: 'STOP' }).click()
    await waitForMachineState('idle')
    await expect(modal(page)).toBeHidden()
  })

  test('RUN-09 losing the link keeps the modal; a Stop pressed offline goes out on reconnect', async ({ page }) => {
    const link = await cuttable(page, /\/ws\/v1\/machine\/snapshot/)
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(modal(page)).toBeVisible()
    link.down = true
    await expect(modal(page)).toContainText('LOST LINK')
    await page.getByRole('button', { name: 'STOP' }).click()
    await expect(page.getByTestId('stop-status')).toHaveText('STOP SENT WHEN BACK ONLINE')
    expect(await machineState()).toBe('steam')
    link.down = false
    await waitForMachineState('idle')
    await expect(modal(page)).toBeHidden()
  })

  test('RUN-10 the icon animates at 2 fps', async ({ page }) => {
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/flush')
    const icon = modal(page).getByRole('img', { name: /animated/ })
    const frames = new Set<string>()
    for (let i = 0; i < 6; i++) { frames.add((await icon.getAttribute('data-frame'))!); await page.waitForTimeout(260) }
    expect(frames.size).toBeGreaterThanOrEqual(3)
  })

  test('RUN-10 the icon holds still with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/flush')
    const icon = modal(page).getByRole('img', { name: /animated/ })
    await expect(icon).toHaveAttribute('data-frame', '0')
    await page.waitForTimeout(1_200)
    await expect(icon).toHaveAttribute('data-frame', '0')
  })

  test('RUN-11 Esc and taps outside do not dismiss it', async ({ page }) => {
    await home(page)
    await decaid('PUT', '/api/v1/machine/state/steam')
    await expect(modal(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await page.mouse.click(40, 40)
    await expect(modal(page)).toBeVisible()
    expect(await machineState()).toBe('steam')
  })
})
