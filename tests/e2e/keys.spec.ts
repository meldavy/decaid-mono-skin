import type { Page } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { currentTitle, expect, test } from './fixtures'

async function home(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  await page.locator('body').click({ position: { x: 600, y: 20 } }) // focus the page, not a control
}

test.describe('Keyboard shortcuts', () => {
  test.beforeEach(async () => {
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
  })

  for (const [key, state] of [['e', 'espresso'], ['w', 'hotWater'], ['s', 'steam'], ['f', 'flush']] as const) {
    test(`KEY-01 ${key.toUpperCase()} on Home starts ${state}`, async ({ page }) => {
      await home(page)
      await page.keyboard.press(key)
      await waitForMachineState(state)
    })
  }

  test('KEY-02 P on Home puts the machine to sleep', async ({ page }) => {
    await home(page)
    await page.keyboard.press('p')
    await waitForMachineState('sleeping')
  })

  test('KEY-03 Space stops espresso from the live shot and steam from its modal', async ({ page }) => {
    await home(page)
    await page.keyboard.press('e')
    await expect(page.getByTestId('live-shot')).toBeVisible()
    await page.keyboard.press(' ')
    await waitForMachineState('idle')
    await page.getByRole('button', { name: 'DONE' }).click({ timeout: 15_000 })
    await page.keyboard.press('s')
    await expect(page.getByTestId('run-modal')).toBeVisible()
    await page.keyboard.press(' ')
    await waitForMachineState('idle')
  })

  for (const [key, state] of [['e', 'espresso'], ['s', 'steam'], ['w', 'hotWater'], ['f', 'flush']] as const) {
    test(`KEY-04 pressing ${key.toUpperCase()} again stops ${state}`, async ({ page }) => {
      await home(page)
      await page.keyboard.press(key)
      await waitForMachineState(state)
      await page.keyboard.press(key)
      await waitForMachineState('idle')
    })
  }

  test('KEY-05 another start key during a running action does nothing', async ({ page }) => {
    await home(page)
    await page.keyboard.press('s')
    await waitForMachineState('steam')
    await page.keyboard.press('w')
    await page.keyboard.press('e')
    await page.waitForTimeout(600)
    expect(await machineState()).toBe('steam')
  })

  test('KEY-06 start keys do nothing off Home or with a sheet open', async ({ page }) => {
    await home(page)
    await page.getByTestId('value-dose').click()
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
    await page.getByRole('button', { name: 'CANCEL' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
  })

  test('KEY-07 no action on key repeat or with a modifier held', async ({ page }) => {
    await home(page)
    await page.keyboard.press('Control+e')
    await page.keyboard.press('Shift+E')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
    await page.locator('body').dispatchEvent('keydown', { key: 'e', repeat: true })
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
  })

  test('KEY-08 a profile key loads that profile and does not start a shot', async ({ page, profiles }) => {
    await decaid('POST', '/api/v1/store/mono/keyboard', { profiles: { '3': profiles[3].id } })
    await home(page)
    await page.keyboard.press('3')
    await expect.poll(currentTitle).toBe(profiles[3].profile.title)
    expect(await machineState()).toBe('idle')
  })

  test('KEY-09 with shortcuts off, no key does anything — Stop included', async ({ page }) => {
    await decaid('POST', '/api/v1/store/mono/keyboard', { enabled: false })
    await home(page)
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
    await decaid('PUT', '/api/v1/machine/state/steam')
    await page.keyboard.press(' ')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('steam')
  })

  test('KEY-10 E respects "require a scale"', async ({ page }) => {
    await decaid('POST', '/api/v1/settings', { blockOnNoScale: true })
    await decaid('POST', '/api/v1/debug/scale/disconnect')
    await home(page)
    await expect(page.getByTestId('weight')).toHaveText('--', { timeout: 10_000 })
    await page.keyboard.press('e')
    await expect(page.getByRole('alert')).toContainText(/scale/i)
    expect(await machineState()).toBe('idle')
  })

  test('KEY-17 key defaults are not written to Decaid until changed', async ({ page }) => {
    await home(page)
    await page.keyboard.press('f')
    await waitForMachineState('flush')
    await page.keyboard.press('f')
    await waitForMachineState('idle')
    expect(await decaid('GET', '/api/v1/store/mono/keyboard')).toBeNull()
  })
})
