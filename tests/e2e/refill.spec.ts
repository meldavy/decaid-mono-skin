import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { expect, test } from './fixtures'

// The mock tank never runs low and the mock machine never asks for water, so these tests drive the water-level
// stream and the machine's state themselves.
async function tank(page: Page) {
  const level = { currentLevel: 40, refillLevel: 5 }
  await page.routeWebSocket(/\/ws\/v1\/machine\/waterLevels/, (ws) => {
    const t = setInterval(() => ws.send(JSON.stringify(level)), 200)
    ws.onClose(() => clearInterval(t))
  })
  return level
}
// While `machine.needsWater` is set, every machine snapshot reports the machine's "needs water" state.
async function machine(page: Page) {
  const m = { needsWater: false }
  await page.routeWebSocket(/:8080\/ws\/v1\/machine\/snapshot/, (ws) => {
    const server = ws.connectToServer()
    server.onMessage((msg) => {
      const s = JSON.parse(String(msg))
      ws.send(JSON.stringify(m.needsWater ? { ...s, state: { state: 'needsWater', substate: 'idle' } } : s))
    })
  })
  return m
}
const refill = (page: Page) => page.getByTestId('refill')

test.describe('Refill tank', () => {
  test('GLB-09 the machine asking for water shows the refill message; refilling closes it by itself', async ({ page }) => {
    const level = await tank(page)
    const m = await machine(page)
    await page.goto('/')
    await expect(page.getByTestId('tank')).toHaveText('54') // 40 mm is 1104 of 2058 ml
    level.currentLevel = 4
    m.needsWater = true
    await expect(refill(page)).toBeVisible()
    await expect(refill(page)).toContainText('REFILL')
    await expect(page.getByTestId('tank-pct')).toHaveText('5%') // 4 mm, 97 ml
    await expect(refill(page)).toContainText('NEEDS 6% TO BREW') // 5 mm, 124 ml
    level.currentLevel = 45
    m.needsWater = false
    await expect(refill(page)).toBeHidden()
  })

  test('GLB-09 a level jittering around the refill threshold never shows the message by itself', async ({ page }) => {
    const level = await tank(page)
    await machine(page)
    await page.goto('/')
    await expect(page.getByTestId('tank')).toHaveText('54')
    for (const mm of [6, 5, 4, 5, 6, 4, 3]) {
      level.currentLevel = mm
      await page.waitForTimeout(250)
      await expect(refill(page)).toBeHidden()
    }
  })

  test('MODAL-02 "Got it" dismisses until the machine is refilled and asks for water again', async ({ page }) => {
    await tank(page)
    const m = await machine(page)
    await page.goto('/')
    m.needsWater = true
    await expect(refill(page)).toBeVisible()
    await page.getByRole('button', { name: 'GOT IT' }).click()
    await expect(refill(page)).toBeHidden()
    await page.waitForTimeout(800)
    await expect(refill(page)).toBeHidden() // still asking, still dismissed
    m.needsWater = false
    await page.waitForTimeout(600)
    m.needsWater = true
    await expect(refill(page)).toBeVisible()
  })

  test('LIVE-10 the tank level dipping to the refill threshold mid-shot leaves the shot alone', async ({ page }) => {
    const level = await tank(page)
    await machine(page)
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await page.goto('/')
    await page.getByRole('button', { name: 'BREW' }).click()
    await expect(page.getByTestId('live-shot')).toBeVisible()
    for (const mm of [5, 4, 6, 4]) {
      level.currentLevel = mm
      await page.waitForTimeout(250)
      await expect(refill(page)).toBeHidden()
    }
    await expect(page.getByTestId('live-shot')).toBeVisible()
  })

  test('GLB-27 the tank gauge sits on the display grid', async ({ page }) => {
    const level = await tank(page)
    const m = await machine(page)
    level.currentLevel = 4
    m.needsWater = true
    await page.goto('/')
    const off = await page.getByTestId('tank-gauge').evaluate((svg) => {
      const d = svg.closest('.display')!.getBoundingClientRect(); const r = svg.getBoundingClientRect()
      return [(r.left - d.left) % 9, (r.top - d.top) % 9]
    })
    expect(off).toEqual([0, 0])
  })
})
