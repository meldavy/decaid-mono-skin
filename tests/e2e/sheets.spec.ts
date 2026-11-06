import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { expect, loadByApi, setFavourites, test, type ProfileRecord } from './fixtures'

type Wf = {
  profile: { title: string; steps: { temperature: number }[] }
  context: { targetDoseWeight: number; targetYield: number }
  steamSettings: { targetTemperature: number; duration: number }
  hotWaterData: { targetTemperature: number; duration: number; volume: number }
  rinseData: { duration: number }
}
const wf = () => decaid<Wf>('GET', '/api/v1/workflow')

const tabValue = async (page: Page, id: string) => (await page.getByTestId(`tab-${id}`).locator('.tab-value').textContent())!.trim()
const sheet = (page: Page) => page.getByRole('dialog')

async function open(page: Page, tile: 'temp' | 'dose' | 'yield' | 'time') {
  await page.goto('/')
  await expect(page.getByTestId(`value-${tile}`)).not.toContainText('—')
  await page.getByTestId(`value-${tile}`).click()
  await expect(sheet(page)).toBeVisible()
}

function workflowWrites(page: Page) {
  const bodies: Record<string, unknown>[] = []
  page.on('request', (r) => { if (r.url().endsWith('/api/v1/workflow') && r.method() === 'PUT') bodies.push(JSON.parse(r.postData() ?? '{}')) })
  return bodies
}

let profile: ProfileRecord

test.describe('Ruler sheets', () => {
  test.beforeEach(async ({ profiles }) => {
    // An espresso profile in the middle of the temperature range, so +/- always has room.
    profile = profiles.find((p) => { const t = (p.profile as unknown as { steps: { temperature: number }[] }).steps.map((s) => s.temperature); return Math.min(...t) >= 85 && Math.max(...t) <= 96 }) ?? profiles[0]
    await setFavourites(profiles.slice(0, 5).map((p) => p.id))
    await loadByApi(profile)
    await decaid('PUT', '/api/v1/workflow', {
      context: { targetDoseWeight: 18, targetYield: 36 },
      steamSettings: { targetTemperature: 150, duration: 50 },
      hotWaterData: { targetTemperature: 75, duration: 30, volume: 50 },
      rinseData: { duration: 10 },
    })
  })

  test('SHEET-01 opens on the tapped value, showing current values', async ({ page }) => {
    const w = await wf()
    for (const [tile, id, expected] of [
      ['temp', 'espressoTemp', w.profile.steps[0].temperature.toFixed(1)],
      ['dose', 'dose', '18.0'],
      ['yield', 'espressoYield', '36.0'],
      ['time', 'shotTarget', '25'],
    ] as const) {
      await open(page, tile)
      await expect(page.getByTestId(`tab-${id}`)).toHaveAttribute('aria-selected', 'true')
      expect(await tabValue(page, id)).toBe(expected)
      await page.getByRole('button', { name: 'CANCEL' }).click()
    }
    await open(page, 'time')
    expect([await tabValue(page, 'hotWaterMax'), await tabValue(page, 'steamMax'), await tabValue(page, 'flushTime')]).toEqual(['30', '50', '10'])
  })

  test('SHEET-01 an allongé yield over 100 g opens on its value with a full ruler', async ({ page }) => {
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 135 } })
    await open(page, 'yield')
    expect(await tabValue(page, 'espressoYield')).toBe('135.0')
    const ruler = page.getByTestId('ruler')
    await expect(ruler).toHaveAttribute('aria-valuenow', '135')
    await expect(ruler).toContainText('135')
    await page.getByRole('button', { name: 'Increase' }).click()
    expect(await tabValue(page, 'espressoYield')).toBe('135.1')
  })

  test('SHEET-02 edits on other tabs are kept while switching, until Save', async ({ page }) => {
    await open(page, 'time')
    await page.getByTestId('tab-steamMax').click()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByTestId('tab-flushTime').click()
    await page.getByRole('button', { name: 'Decrease' }).click()
    await page.getByTestId('tab-steamMax').click()
    expect(await tabValue(page, 'steamMax')).toBe('51')
    expect(await tabValue(page, 'flushTime')).toBe('9')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    const w = await wf()
    expect([w.steamSettings.duration, w.rinseData.duration]).toEqual([51, 9])
  })

  test('SHEET-03 dragging the ruler changes the value in steps', async ({ page }) => {
    await open(page, 'dose')
    const ruler = page.getByTestId('ruler')
    const box = (await ruler.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + 10, { steps: 6 }) // 5 steps of 12 px
    await page.mouse.up()
    expect(await tabValue(page, 'dose')).toBe('18.5')
    await page.mouse.move(box.x + box.width / 2, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 2400, box.y + 10, { steps: 10 })
    await page.mouse.up()
    expect(await tabValue(page, 'dose')).toBe('5.0') // clamps at min
  })

  test('SHEET-04 − / + change one step per tap; holding repeats and stops on release', async ({ page }) => {
    await open(page, 'time')
    await page.getByTestId('tab-hotWaterMax').click()
    await page.getByRole('button', { name: 'Increase' }).click()
    expect(await tabValue(page, 'hotWaterMax')).toBe('31')
    await page.getByRole('button', { name: 'Decrease' }).click()
    await page.getByRole('button', { name: 'Decrease' }).click()
    expect(await tabValue(page, 'hotWaterMax')).toBe('29')
    const plus = page.getByRole('button', { name: 'Increase' })
    await plus.hover()
    await page.mouse.down()
    await page.waitForTimeout(1_600)
    await page.mouse.up()
    const afterHold = Number(await tabValue(page, 'hotWaterMax'))
    expect(afterHold).toBeGreaterThan(32)
    await page.waitForTimeout(600)
    expect(Number(await tabValue(page, 'hotWaterMax'))).toBe(afterHold)
  })

  test('SHEET-06 a preset sets the value; a saved value becomes a preset', async ({ page }) => {
    await open(page, 'time')
    await page.getByTestId('tab-steamMax').click()
    await page.getByRole('button', { name: '45', exact: true }).click()
    expect(await tabValue(page, 'steamMax')).toBe('45')
    await expect(page.getByRole('button', { name: '45', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    await page.getByTestId('value-time').click()
    await page.getByTestId('tab-steamMax').click()
    await expect(page.getByRole('button', { name: '47', exact: true })).toBeVisible()
  })

  test('SHEET-07 Save sends only the changed values and closes after Decaid confirms', async ({ page }) => {
    const bodies = workflowWrites(page)
    await open(page, 'temp')
    await page.getByTestId('tab-hotWaterTemp').click()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
    expect(bodies).toEqual([{ hotWaterData: { targetTemperature: 76 } }])
    expect((await wf()).hotWaterData.targetTemperature).toBe(76)
  })

  test('SHEET-08 one failing write → "saved some", only the failed value stays edited', async ({ page }) => {
    await open(page, 'time')
    await page.route('**/api/v1/workflow', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{"error":"nope"}' }) : route.continue()))
    await page.getByRole('button', { name: 'Increase' }).click() // shot target → Mono store (works)
    await page.getByTestId('tab-flushTime').click()
    await page.getByRole('button', { name: 'Increase' }).click() // flush → workflow (fails)
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByTestId('sheet-status')).toHaveText("SAVED SOME · FLUSH DIDN'T SAVE")
    await expect(sheet(page)).toBeVisible()
    expect((await decaid<Record<string, number>>('GET', '/api/v1/store/mono/target-times'))[profile.id]).toBe(26)
    expect((await wf()).rinseData.duration).toBe(10)
    expect(await tabValue(page, 'flushTime')).toBe('11')
  })

  test('SHEET-09 a failed save keeps the sheet open with the edits', async ({ page }) => {
    await open(page, 'dose')
    await page.route('**/api/v1/workflow', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()))
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByTestId('sheet-status')).toContainText("COULDN'T SAVE")
    expect(await tabValue(page, 'dose')).toBe('18.1')
    expect((await wf()).context.targetDoseWeight).toBe(18)
  })

  for (const how of ['Cancel button', 'scrim tap', 'swipe down', 'Esc'] as const) {
    test(`SHEET-10 cancel by ${how} sends nothing`, async ({ page }) => {
      const bodies = workflowWrites(page)
      await open(page, 'dose')
      await page.getByRole('button', { name: 'Increase' }).click()
      if (how === 'Cancel button') await page.getByRole('button', { name: 'CANCEL' }).click()
      if (how === 'scrim tap') await page.getByTestId('scrim').click({ position: { x: 600, y: 60 } })
      if (how === 'Esc') await page.keyboard.press('Escape')
      if (how === 'swipe down') {
        const h = (await page.getByTestId('sheet-handle').boundingBox())!
        await page.mouse.move(h.x + h.width / 2, h.y + 10)
        await page.mouse.down()
        await page.mouse.move(h.x + h.width / 2, h.y + 200, { steps: 5 })
        await page.mouse.up()
      }
      await expect(sheet(page)).toBeHidden()
      expect(bodies).toEqual([])
      expect((await wf()).context.targetDoseWeight).toBe(18)
    })
  }

  test('SHEET-11 espresso values go to the profile / context; the rest to workflow sections', async ({ page }) => {
    const bodies = workflowWrites(page)
    const before = await wf()
    await open(page, 'temp')
    await page.getByRole('button', { name: 'Increase' }).click() // espresso +0.5
    await page.getByTestId('tab-steamTemp').click()
    await page.getByRole('button', { name: 'Decrease' }).click()
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    expect(bodies).toHaveLength(1)
    expect(Object.keys(bodies[0]).sort()).toEqual(['profile', 'steamSettings'])
    const after = await wf()
    expect(after.profile.steps.map((s) => s.temperature)).toEqual(before.profile.steps.map((s) => s.temperature + 0.5))
    expect(after.steamSettings.targetTemperature).toBe(149)
  })

  test('SHEET-13 SHEET-14 a note only when no scale is connected', async ({ page }) => {
    await open(page, 'yield')
    await expect(page.getByTestId('sheet-note')).toHaveText('')
    await page.getByTestId('tab-hotWaterAmount').click()
    await expect(page.getByTestId('sheet-note')).toHaveText('')
    await page.routeWebSocket(/\/ws\/v1\/devices/, (ws) => {
      const server = ws.connectToServer()
      server.onMessage((m) => {
        const msg = JSON.parse(String(m))
        msg.devices = msg.devices.filter((d: { type: string }) => d.type !== 'scale')
        ws.send(JSON.stringify(msg))
      })
    })
    await page.reload()
    await page.getByTestId('value-yield').click()
    await expect(page.getByTestId('sheet-note')).toHaveText('The shot will stop at this weight when a scale is connected.')
    await page.getByTestId('tab-hotWaterAmount').click()
    await expect(page.getByTestId('sheet-note')).toHaveText('Hot water will stop by volume until a scale is connected.')
  })

  test('SHEET-15 shot target saves per profile in Mono\'s store; the default is not stored', async ({ page, profiles }) => {
    await open(page, 'time')
    await expect(page.getByTestId('sheet-note')).toHaveText('This is your shot target time, a baseline used to compare against your actual shot finish time.')
    expect(await decaid('GET', '/api/v1/store/mono/target-times')).toBeNull()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    expect(await decaid('GET', '/api/v1/store/mono/target-times')).toEqual({ [profile.id]: 27 })
    await expect(page.getByTestId('value-time')).toContainText('27')
    await loadByApi(profiles.find((p) => p.id !== profile.id)!) // any other profile: back to the default
    await expect(page.getByTestId('value-time')).toContainText('25', { timeout: 8_000 })
  })

  test('SHEET-16 steam Off writes 0; turning it back on restores a valid temperature', async ({ page }) => {
    await open(page, 'temp')
    await page.getByTestId('tab-steamTemp').click()
    await page.getByRole('button', { name: 'OFF', exact: true }).click()
    expect(await tabValue(page, 'steamTemp')).toBe('OFF')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    expect((await wf()).steamSettings.targetTemperature).toBe(0)
    await page.getByTestId('value-temp').click()
    await page.getByTestId('tab-steamTemp').click()
    await page.getByRole('button', { name: 'Increase' }).click()
    expect(await tabValue(page, 'steamTemp')).toBe('135')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    expect((await wf()).steamSettings.targetTemperature).toBe(135)
  })

  test('SHEET-17 outside change while open: untouched values refresh, an edited one is kept and flagged', async ({ page }) => {
    await open(page, 'time')
    await page.getByTestId('tab-steamMax').click()
    await page.getByRole('button', { name: 'Increase' }).click() // 51
    await decaid('PUT', '/api/v1/workflow', { steamSettings: { duration: 40 }, rinseData: { duration: 7 } })
    await expect.poll(() => tabValue(page, 'flushTime'), { timeout: 8_000 }).toBe('7')
    expect(await tabValue(page, 'steamMax')).toBe('51')
    await expect(page.getByTestId('sheet-note')).toContainText('Changed on another device')
    await page.getByRole('button', { name: 'SAVE' }).click()
    await expect(sheet(page)).toBeHidden()
    expect((await wf()).steamSettings.duration).toBe(51)
    expect((await wf()).rinseData.duration).toBe(7)
  })

  test('the sheet\'s Save sits on the same right edge as Brew (shared page padding)', async ({ page }) => {
    await page.goto('/')
    const brew = (await page.getByRole('button', { name: 'BREW' }).boundingBox())!
    await page.getByTestId('value-dose').click()
    const save = (await page.getByRole('button', { name: 'SAVE' }).boundingBox())!
    expect(save.x + save.width).toBe(brew.x + brew.width)
  })

  test('SHEET-19 repeat-tapping Save sends once', async ({ page }) => {
    const bodies = workflowWrites(page)
    await open(page, 'dose')
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'SAVE' }).evaluate((el: HTMLButtonElement) => { el.click(); el.click(); el.click() })
    await expect(sheet(page)).toBeHidden()
    expect(bodies).toHaveLength(1)
  })
})
