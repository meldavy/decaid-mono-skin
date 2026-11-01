import type { Page } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { expect, test } from './fixtures'

const sleep = (page: Page) => page.getByTestId('sleep')

async function asleep(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  await decaid('PUT', '/api/v1/machine/state/sleeping')
  await expect(sleep(page)).toBeVisible()
}

async function setPrefs(prefs: Record<string, unknown>) {
  await decaid('POST', '/api/v1/store/mono/prefs', prefs)
}

// Pretends the platform can change brightness (the Linux simulator can't) and records what Mono asks for.
async function fakeBrightness(page: Page) {
  const set: number[] = []
  let current = 70
  await page.route('**/api/v1/display', (route) => route.fulfill({ json: { brightness: current, requestedBrightness: current, platformSupported: { brightness: true, wakeLock: true } } }))
  await page.route('**/api/v1/display/brightness', async (route) => {
    current = JSON.parse(route.request().postData() ?? '{}').brightness
    set.push(current)
    await route.fulfill({ json: { brightness: current, requestedBrightness: current } })
  })
  return set
}

async function holdOnScreen(page: Page, ms: number) {
  await page.mouse.move(600, 300)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test.describe('Sleep', () => {
  test('SLEEP-01 shown only while the machine reports sleeping', async ({ page }) => {
    await asleep(page)
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(sleep(page)).toBeHidden()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })

  test('HOME-16 the Sleep button puts the machine to sleep; the sleep screen follows the machine', async ({ page }) => {
    await page.goto('/')
    await page.route('**/machine/state/sleeping', async (route) => { await new Promise((r) => setTimeout(r, 500)); await route.continue() })
    await page.getByRole('button', { name: 'Sleep' }).click()
    await expect(sleep(page)).toBeHidden() // not before the machine confirms
    await waitForMachineState('sleeping')
    await expect(sleep(page)).toBeVisible()
  })

  test('SLEEP-02 dot clock, SLEEPING and the date; 12-hour clock when chosen; next wake time', async ({ page }) => {
    await page.route('**/api/v1/presence/schedules', (route) => route.fulfill({ json: [{ id: 's', time: '06:30', daysOfWeek: [], enabled: true }] }))
    await asleep(page)
    const label = await page.getByTestId('sleep-clock').getAttribute('aria-label')
    expect(label).toMatch(/^\d{2}:\d{2}$/)
    await expect(sleep(page)).toContainText('SLEEPING')
    await expect(sleep(page)).toContainText(/(SUN|MON|TUE|WED|THU|FRI|SAT) · \d{1,2} (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/)
    await expect(page.getByTestId('wakes-at')).toHaveText('WAKES AT 06:30')
    await setPrefs({ clock: '12' })
    await page.reload()
    await expect(page.getByTestId('sleep-clock')).toHaveAttribute('aria-label', /^\d{1,2}:\d{2}$/)
    await expect(page.getByTestId('wakes-at')).toHaveText('WAKES AT 6:30')
  })

  test('SLEEP-03 the screen goes dark after the set time and brightness goes to 0', async ({ page }) => {
    await setPrefs({ screenOffAfter: 2 })
    const set = await fakeBrightness(page)
    await asleep(page)
    await expect(sleep(page)).toHaveAttribute('data-dark', 'false')
    await expect(sleep(page)).toHaveAttribute('data-dark', 'true', { timeout: 5_000 })
    await expect.poll(() => set).toEqual([0])
  })

  test('SLEEP-04 a tap while dark brings the clock back without waking the machine', async ({ page }) => {
    await setPrefs({ screenOffAfter: 1 })
    await asleep(page)
    await expect(sleep(page)).toHaveAttribute('data-dark', 'true', { timeout: 4_000 })
    await page.mouse.click(600, 300)
    await expect(sleep(page)).toHaveAttribute('data-dark', 'false')
    expect(await machineState()).toBe('sleeping')
  })

  test('SLEEP-05 holding anywhere wakes the machine and returns Home', async ({ page }) => {
    await asleep(page)
    await holdOnScreen(page, 1_100)
    await waitForMachineState('idle')
    await expect(sleep(page)).toBeHidden()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })

  test('SLEEP-06 releasing a hold early keeps the machine asleep', async ({ page }) => {
    await asleep(page)
    await holdOnScreen(page, 350)
    await page.waitForTimeout(800)
    expect(await machineState()).toBe('sleeping')
    await expect(sleep(page)).toBeVisible()
  })

  test('SLEEP-07 woken from outside (machine, schedule) → Home', async ({ page }) => {
    await asleep(page)
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(sleep(page)).toBeHidden()
  })

  test('SLEEP-08 normal brightness is restored on wake', async ({ page }) => {
    await setPrefs({ screenOffAfter: 1 })
    const set = await fakeBrightness(page)
    await asleep(page)
    await expect.poll(() => set).toEqual([0])
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(sleep(page)).toBeHidden()
    await expect.poll(() => set).toEqual([0, 70])
  })

  test('GLB-26 a long last-shot profile name stays on one line on the sleep screen', async ({ page }) => {
    await page.route('**/api/v1/shots/latest', (route) => route.fulfill({ json: { timestamp: new Date().toISOString(), workflow: { profile: { title: 'Pour over basket/Cold brew 22g in, 375ml out — extended slow bloom with a much longer name' } } } }))
    await asleep(page)
    const title = sleep(page).locator('.sleep-last-title')
    await expect(title).toBeVisible()
    expect((await title.boundingBox())!.height).toBeLessThan(32)
  })
})
