import { configurationSnapshot, decaid, machineState, waitForMachineState } from './decaid'
import { currentTitle, expect, loadByApi, setFavourites, test } from './fixtures'

test.describe('Home', () => {
  test.beforeEach(async ({ profiles }) => {
    // Five known favourites; the machine on slot 1.
    await setFavourites(profiles.slice(0, 5).map((p) => p.id))
    await loadByApi(profiles[0])
  })

  test('GLB-01 opening Home writes nothing to Decaid', async ({ page }) => {
    const before = await configurationSnapshot()
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes(':8080') && r.method() !== 'GET' && !r.url().endsWith('/machine/heartbeat')) writes.push(`${r.method()} ${r.url()}`) })
    await page.goto('/')
    await expect(page.getByTestId('thermal')).not.toHaveText('NO MACHINE')
    await page.waitForTimeout(3_000)
    expect(writes).toEqual([])
    expect(await configurationSnapshot()).toEqual(before)
  })

  test('HOME-01 display shows live temperatures, weight and tank', async ({ page }) => {
    await page.goto('/')
    const snap = await decaid<{ groupTemperature: number }>('GET', '/api/v1/machine/state')
    await expect(page.getByTestId('group-temp')).toHaveText(/^\d+\.\d$/)
    expect(Math.abs(Number(await page.getByTestId('group-temp').textContent()) - snap.groupTemperature)).toBeLessThan(3)
    await expect(page.getByTestId('steam-temp')).toHaveText(/^\d+$/)
    await expect(page.getByTestId('weight')).toHaveText(/^-?\d+\.\d$/)
    await expect(page.getByTestId('tank')).toHaveText(/^\d+$/)
  })

  test('HOME-03 carousel shows the five shared favourites; empty slots are empty', async ({ page, profiles }) => {
    await setFavourites([profiles[0].id, null, profiles[2].id, null, null])
    await page.goto('/')
    await expect(page.getByTestId('main-card')).toContainText(profiles[0].profile.title)
    await expect(page.getByLabel('Slot 2, empty')).toBeVisible()
    await expect(page.getByRole('button', { name: `Slot 3, ${profiles[2].profile.title}` })).toBeVisible()
  })

  test('HOME-04 tapping a side card centres it and loads it on the machine', async ({ page, profiles }) => {
    await page.goto('/')
    await expect(page.getByTestId('main-card')).toContainText('SELECTED')
    await page.getByRole('button', { name: `Slot 2, ${profiles[1].profile.title}` }).click()
    await expect(page.getByTestId('main-card')).toContainText(profiles[1].profile.title)
    await expect.poll(currentTitle).toBe(profiles[1].profile.title)
    await expect(page.getByTestId('main-card')).toContainText('SELECTED')
  })

  test('HOME-19 tapping the card in front opens its details with its edit buttons (no slot picker); closing writes nothing', async ({ page, profiles }) => {
    await page.goto('/')
    const card = page.getByTestId('main-card')
    await expect(card).toContainText('SELECTED')
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes(':8080') && r.method() !== 'GET' && !r.url().endsWith('/machine/heartbeat')) writes.push(r.url()) })
    await card.click()
    const dialog = page.getByRole('dialog', { name: profiles[0].profile.title })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('dot-chart')).toBeVisible()
    await expect(dialog.getByRole('radiogroup')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /PUT IN SLOT|MOVE TO SLOT|REMOVE FROM SLOT/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: profiles[0].isDefault ? 'EDIT A COPY' : 'EDIT' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await card.press('Enter')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    expect(writes).toEqual([])
    // Editing from here comes back here.
    await card.click()
    await dialog.getByRole('button', { name: profiles[0].isDefault ? 'EDIT A COPY' : 'EDIT', exact: true }).click()
    await expect(page.getByTestId('editor')).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    if (profiles[0].isDefault) await page.getByRole('button', { name: 'DISCARD' }).click() // an unsaved copy asks first
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })

  test('HOME-05 swiping past several cards loads only where it settles; Brew waits', async ({ page, profiles }) => {
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/workflow') && r.method() === 'PUT') writes.push(r.postData() ?? '') })
    await page.goto('/')
    const box = (await page.getByLabel('Favourite profiles').boundingBox())!
    const swipeLeft = async () => {
      await page.mouse.move(box.x + box.width * 0.7, box.y + 150)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.3, box.y + 150, { steps: 5 })
      await page.mouse.up()
    }
    await swipeLeft()
    await swipeLeft()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeDisabled()
    await expect(page.getByTestId('main-card')).toContainText(profiles[2].profile.title)
    await expect.poll(currentTitle).toBe(profiles[2].profile.title)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain(profiles[2].profile.title)
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  })

  test('HOME-06 a non-favourite active profile gets a sixth card, selected; it goes once a favourite is chosen', async ({ page, profiles }) => {
    await loadByApi(profiles[7])
    await page.goto('/')
    await expect(page.getByTestId('main-card')).toContainText(profiles[7].profile.title)
    await expect(page.getByTestId('main-card')).toContainText('06 / 06 · SELECTED')
    await expect(page.getByLabel('Profile 6 of 6')).toBeVisible()
    // A card left of the main one shows only its right edge: tap that.
    const slot5 = page.getByRole('button', { name: `Slot 5, ${profiles[4].profile.title}` })
    await slot5.click({ position: { x: (await slot5.boundingBox())!.width - 30, y: 60 } })
    await expect.poll(currentTitle).toBe(profiles[4].profile.title)
    await expect(page.getByLabel('Profile 5 of 5')).toBeVisible()
    await expect(page.getByTestId('main-card')).toContainText('05 / 05 · SELECTED')
    expect((await decaid<Record<string, string>>('GET', '/api/v1/store/streamline-app/favorite-profiles'))['0']).toBe(profiles[0].id)
  })

  test('HOME-18 long names shrink once and stop at their line limit; cards keep their size', async ({ page, profiles }) => {
    const longest = [...profiles].sort((a, b) => b.profile.title.length - a.profile.title.length)
    await setFavourites([longest[0].id, longest[1].id, longest[2].id, null, null])
    await loadByApi(longest[0])
    await page.goto('/')
    const main = page.getByTestId('main-card')
    await expect(main).toContainText(longest[0].profile.title)
    const title = main.locator('.title')
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('32px')
    const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
    expect(lines).toBeLessThanOrEqual(2)
    expect((await main.boundingBox())!.height).toBe(340)
    const side = page.getByRole('button', { name: `Slot 2, ${longest[1].profile.title}` }).locator('.name')
    expect(await side.evaluate((el) => getComputedStyle(el).fontSize)).toBe('20px')
    expect(await side.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))).toBeLessThanOrEqual(3)
    const planTitle = page.getByTestId('plan-title')
    expect(await planTitle.evaluate((el) => getComputedStyle(el).textAlign)).toBe('right')
    expect(await planTitle.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe('2') // clamped at two lines
    expect(await planTitle.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(34)
  })

  test('HOME-09 start buttons are disabled while the machine sleeps or runs; no request sent', async ({ page }) => {
    await page.goto('/')
    const starts: string[] = []
    page.on('request', (r) => { if (r.url().includes('/machine/state/')) starts.push(r.url()) })
    await decaid('PUT', '/api/v1/machine/state/sleeping')
    for (const name of ['BREW', 'STEAM', 'WATER', 'FLUSH']) await expect(page.getByRole('button', { name })).toBeDisabled()
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
    await decaid('PUT', '/api/v1/machine/state/flush')
    for (const name of ['BREW', 'STEAM', 'WATER', 'FLUSH']) await expect(page.getByRole('button', { name })).toBeDisabled()
    expect(starts).toEqual([])
  })

  test('HOME-10 repeat-tapping Brew sends one request', async ({ page }) => {
    await page.goto('/')
    const starts: string[] = []
    page.on('request', (r) => { if (r.url().endsWith('/machine/state/espresso')) starts.push(r.url()) })
    const brew = page.getByRole('button', { name: 'BREW' })
    await expect(brew).toBeEnabled()
    await brew.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); el.click() })
    await waitForMachineState('espresso')
    expect(starts).toHaveLength(1)
  })

  test('starts espresso from Brew', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'BREW' }).click()
    await waitForMachineState('espresso')
  })


  test('HOME-13 an outside change to dose / yield shows within a few seconds', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('value-dose')).toContainText('DOSE G')
    await decaid('PUT', '/api/v1/workflow', { context: { targetDoseWeight: 19.5, targetYield: 41 } })
    await expect(page.getByTestId('value-dose')).toContainText('19.5', { timeout: 8_000 })
    await expect(page.getByTestId('value-yield')).toContainText('41.0')
  })

  test('HOME-14 tapping the weight tares the scale', async ({ page }) => {
    await page.goto('/')
    const tares: string[] = []
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/scale/tare')) tares.push(r.method()) })
    await page.getByRole('button', { name: 'Tare scale' }).click()
    await expect.poll(() => tares).toEqual(['PUT'])
    await expect(page.getByTestId('weight')).toHaveText(/^-?0\.\d$/)
  })

  test('HOME-14 tare is disabled with no scale', async ({ page }) => {
    await page.goto('/')
    await page.routeWebSocket(/\/ws\/v1\/devices/, (ws) => {
      const server = ws.connectToServer()
      server.onMessage((m) => {
        const msg = JSON.parse(String(m))
        msg.devices = msg.devices.filter((d: { type: string }) => d.type !== 'scale')
        ws.send(JSON.stringify(msg))
      })
    })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Tare scale' })).toBeDisabled()
    await expect(page.getByTestId('weight')).toHaveText('--')
  })

  test('HOME-15 Profiles, History and Settings open their screens and come back', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'All profiles', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    await page.getByRole('button', { name: 'Back to home' }).click()
    for (const [name, label] of [['History', 'HISTORY'], ['Settings', 'SETTINGS']]) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByText(label, { exact: false })).toBeVisible()
      await page.getByRole('button', { name: 'BACK' }).click()
      await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
    }
  })

  test('puts the machine to sleep from Zz [HOME-16 part: Sleep screen not built]', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Sleep' }).click()
    await waitForMachineState('sleeping')
    expect(await machineState()).toBe('sleeping')
  })

  test('HOME-17 the selected profile is drawn solid: pressure in ink, flow in the accent', async ({ page }) => {
    await page.goto('/')
    const chart = page.getByTestId('main-card').getByTestId('dot-chart')
    await expect(chart.locator('[data-series="plan"] circle')).toHaveCount(0)
    await expect.poll(() => chart.locator('[data-series="pressure"] circle, [data-series="flow"] circle').count()).toBeGreaterThan(30)
  })

  // Feeds Home a machine snapshot stream: real frames rewritten by `edit`, or nothing after `stopAfter` frames.
  async function snapshots(page: import('@playwright/test').Page, edit: (m: Record<string, unknown>) => Record<string, unknown>, stopAfter = Infinity) {
    await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot/, (ws) => {
      const server = ws.connectToServer()
      let sent = 0
      server.onMessage((m) => { if (sent++ < stopAfter) ws.send(JSON.stringify(edit(JSON.parse(String(m))))) })
    })
  }

  test('HOME-02 heating shows HEATING (with the countdown when the plugin sends one); in range shows READY', async ({ page }) => {
    await snapshots(page, (m) => ({ ...m, state: { state: 'idle', substate: 'idle' }, groupTemperature: 61, targetGroupTemperature: 90 }))
    await page.route('**/api/v1/plugins', async (route) => {
      const res = await route.fetch(); const list = await res.json()
      await route.fulfill({ response: res, json: list.map((p: { id: string }) => (p.id === 'time-to-ready.reaplugin' ? { ...p, autoLoad: true, loaded: true } : p)) })
    })
    await page.routeWebSocket(/time-to-ready/, (ws) => {
      const t = setInterval(() => ws.send(JSON.stringify({ status: 'heating', remainingTimeMs: 42_000 })), 500)
      ws.onClose(() => clearInterval(t))
    })
    await page.goto('/')
    await expect(page.getByTestId('thermal')).toHaveText(/^HEATING · (4[0-2]) S$/)
  })

  test('HOME-02 heating without the plugin says just HEATING; in range says READY', async ({ page }) => {
    let temp = 61
    await snapshots(page, (m) => ({ ...m, state: { state: 'idle', substate: 'idle' }, groupTemperature: temp, targetGroupTemperature: 90 }))
    await page.goto('/')
    await expect(page.getByTestId('thermal')).toHaveText('HEATING')
    temp = 89.2
    await expect(page.getByTestId('thermal')).toHaveText('READY')
  })

  test('HOME-02 stale data never shows READY', async ({ page }) => {
    await snapshots(page, (m) => ({ ...m, state: { state: 'idle', substate: 'idle' }, groupTemperature: 90, targetGroupTemperature: 90 }), 3)
    await page.goto('/')
    await expect(page.getByTestId('thermal')).toHaveText('READY')
    await expect(page.getByTestId('thermal')).toHaveText('NO DATA', { timeout: 10_000 }) // 3 s after the last frame
  })

  test('HOME-08 Brew with "require a scale" on and no scale is blocked with a message', async ({ page }) => {
    await decaid('POST', '/api/v1/settings', { blockOnNoScale: true })
    await decaid('POST', '/api/v1/debug/scale/disconnect')
    await page.goto('/')
    await expect(page.getByTestId('weight')).toHaveText('--', { timeout: 10_000 })
    await page.getByRole('button', { name: 'BREW' }).click()
    await expect(page.getByRole('alert')).toContainText(/scale/i)
    await page.waitForTimeout(1_000)
    expect(await machineState()).toBe('idle')
  })

  for (const [name, kind] of [['STEAM', 'steam'], ['WATER', 'hotWater'], ['FLUSH', 'flush']] as const) {
    test(`HOME-11 ${name} starts ${kind} and opens its modal`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('button', { name }).click()
      await waitForMachineState(kind)
      await expect(page.getByTestId('run-modal')).toHaveAttribute('data-kind', kind)
    })
  }

  test('HOME-12 each value opens its ruler sheet on that value', async ({ page }) => {
    await page.goto('/')
    for (const [tile, tab] of [['temp', 'espressoTemp'], ['dose', 'dose'], ['yield', 'espressoYield'], ['time', 'shotTarget']]) {
      await page.getByTestId(`value-${tile}`).click()
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('button', { name: 'CANCEL' }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
    }
  })
})
