import type { Page, Request } from '@playwright/test'
import { decaid, machineState, waitForMachineState } from './decaid'
import { expect, test } from './fixtures'

type Settings = Record<string, unknown>
type Presence = { userPresenceEnabled: boolean; sleepTimeoutMinutes: number; schedules: { id: string; time: string; daysOfWeek: number[]; enabled: boolean }[] }

async function open(page: Page, section?: string) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings')).toBeVisible()
  if (section) await page.getByRole('button', { name: section, exact: true }).click()
}

async function hold(page: Page, name: string, ms: number) {
  const box = (await page.getByRole('button', { name }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

async function setValue(page: Page, row: RegExp, value: number) {
  await page.getByRole('button', { name: row }).click()
  const sheet = page.getByRole('dialog')
  const slider = sheet.getByRole('slider')
  await slider.focus()
  const now = Number(await slider.getAttribute('aria-valuenow'))
  const step = Number(await slider.getAttribute('data-step'))
  const presses = Math.round((value - now) / step)
  for (let i = 0; i < Math.abs(presses); i++) await page.keyboard.press(presses > 0 ? 'ArrowRight' : 'ArrowLeft')
  await sheet.getByRole('button', { name: 'DONE' }).click()
  await expect(sheet).toBeHidden()
}

// Every write Mono sends, so a test can check it touched only the key it meant to.
function writes(page: Page) {
  const seen: { method: string; path: string; body: unknown }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'GET' || !r.url().includes(':8080/api/') || r.url().endsWith('/machine/heartbeat')) return
    seen.push({ method: r.method(), path: new URL(r.url()).pathname, body: r.postDataJSON() })
  })
  return seen
}

const settings = () => decaid<Settings>('GET', '/api/v1/settings')
const presence = () => decaid<Presence>('GET', '/api/v1/presence/settings')
const monoPrefs = () => decaid<Record<string, unknown> | null>('GET', '/api/v1/store/mono/prefs').catch(() => null)
const keyboard = () => decaid<{ enabled: boolean; actions: Record<string, string>; profiles: Record<string, string> } | null>('GET', '/api/v1/store/mono/keyboard').catch(() => null)

test.describe('Settings', () => {
  test('SET-01 opening Settings and every section writes nothing', async ({ page }) => {
    const seen = writes(page)
    await open(page)
    for (const s of ['Devices & water', 'Maintenance', 'Sleep & display', 'Look & sound', 'Keyboard', 'System', 'Brewing']) {
      await page.getByRole('button', { name: s, exact: true }).click()
      await expect(page.getByRole('button', { name: s, exact: true })).toHaveAttribute('aria-current', 'true')
    }
    await page.waitForTimeout(500)
    expect(seen).toEqual([])
  })

  test('SET-01 SET-02 toggles read Decaid and write only their own key', async ({ page }) => {
    const before = await settings()
    const seen = writes(page)
    await open(page)
    const sw = page.getByRole('switch', { name: 'Require a scale to brew' })
    await expect(sw).toHaveAttribute('aria-checked', String(before.blockOnNoScale))
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', String(!before.blockOnNoScale))
    await expect.poll(async () => (await settings()).blockOnNoScale).toBe(!before.blockOnNoScale)
    expect(seen).toEqual([{ method: 'POST', path: '/api/v1/settings', body: { blockOnNoScale: !before.blockOnNoScale } }])
    const hw = page.getByRole('switch', { name: 'Stop hot water at weight' })
    await hw.click()
    await expect.poll(async () => (await settings()).stopHotWaterAtWeight).toBe(!before.stopHotWaterAtWeight)
    await page.getByRole('switch', { name: "Don't tare during a shot" }).click()
    await expect.poll(async () => (await settings()).blockTareDuringShot).toBe(!before.blockTareDuringShot)
  })

  test('SET-02 early stop for weight and hot water', async ({ page }) => {
    await open(page)
    await setValue(page, /^Early stop for weight/, 1.5)
    await expect.poll(async () => (await settings()).weightFlowMultiplier).toBe(1.5)
    await expect(page.getByRole('button', { name: /^Early stop for weight/ })).toContainText(/1\.50\s*s/i)
    await setValue(page, /^Early stop for hot water/, 0.5)
    await expect.poll(async () => (await settings()).hotWaterFlowMultiplier).toBe(0.5)
  })

  test('SET-02 cancelling a value sheet writes nothing', async ({ page }) => {
    const seen = writes(page)
    await open(page)
    await page.getByRole('button', { name: /^Early stop for weight/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Increase' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(seen).toEqual([])
  })

  test('SET-03 sleep & display values', async ({ page }) => {
    const before = await settings()
    await open(page, 'Sleep & display')
    // The simulator can't change brightness, so the row says so and is disabled.
    await expect(page.getByRole('button', { name: /^Brightness/ })).toBeDisabled()
    await setValue(page, /^Sleep screen goes dark after/, 120)
    await expect.poll(async () => (await monoPrefs())?.screenOffAfter).toBe(120)
    await page.getByRole('switch', { name: 'Keep the screen awake' }).click()
    await expect.poll(async () => (await settings()).keepAwake).toBe(!before.keepAwake)
    await setValue(page, /^Sleep after/, 45)
    await expect.poll(async () => (await presence()).sleepTimeoutMinutes).toBe(45)
    await page.getByRole('switch', { name: 'Night mode' }).click()
    await expect.poll(async () => (await settings()).nightModeEnabled).toBe(!before.nightModeEnabled)
    await page.getByRole('radio', { name: 'Protect the battery' }).click()
    await expect.poll(async () => (await settings()).chargingMode).toBe('longevity')
    await expect(page.getByRole('radio', { name: 'Protect the battery' })).toHaveAttribute('aria-checked', 'true')
  })

  test('SET-04 wake schedules: add, disable, delete with hold', async ({ page }) => {
    await open(page, 'Sleep & display')
    await page.getByRole('button', { name: 'Add a wake time' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add a wake time' })
    await sheet.getByRole('button', { name: 'Hour up' }).click()
    await sheet.getByRole('button', { name: 'Minute down' }).click()
    await sheet.getByRole('button', { name: 'SAT' }).click()
    await sheet.getByRole('button', { name: 'ADD 07:25' }).click()
    await expect(page.getByTestId('schedule')).toHaveCount(1)
    const [s] = (await presence()).schedules
    expect(s).toMatchObject({ time: '07:25', daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true })
    await expect(page.getByTestId('schedule')).toContainText('MON · TUE · WED · THU · FRI · SAT')
    await page.getByRole('switch', { name: 'Wake at 07:25' }).click()
    await expect.poll(async () => (await presence()).schedules[0]?.enabled).toBe(false)
    await page.getByRole('button', { name: 'Delete wake at 07:25' }).click()
    await hold(page, 'HOLD TO DELETE', 300)
    expect((await presence()).schedules).toHaveLength(1)
    await hold(page, 'HOLD TO DELETE', 1_500)
    await expect(page.getByTestId('schedule')).toHaveCount(0)
    expect((await presence()).schedules).toHaveLength(0)
  })

  test('SET-04 a wake time needs at least one day; cancel adds nothing', async ({ page }) => {
    await open(page, 'Sleep & display')
    await page.getByRole('button', { name: 'Add a wake time' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add a wake time' })
    for (const d of ['MON', 'TUE', 'WED', 'THU', 'FRI']) await sheet.getByRole('button', { name: d }).click()
    await expect(sheet.getByText('PICK AT LEAST ONE DAY')).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^ADD / })).toBeDisabled()
    await sheet.getByRole('button', { name: 'Hour down' }).click()
    for (let i = 0; i < 7; i++) await sheet.getByRole('button', { name: 'Hour down' }).click()
    await expect(sheet.getByTestId('stepper-hour')).toHaveText('22') // wraps past midnight
    await sheet.getByRole('button', { name: 'CANCEL' }).click()
    expect((await presence()).schedules).toHaveLength(0)
  })

  test('SET-05 presence off disables "sleep after"', async ({ page }) => {
    await open(page, 'Sleep & display')
    await page.getByRole('switch', { name: "Sleep when nobody's around" }).click()
    await expect.poll(async () => (await presence()).userPresenceEnabled).toBe(false)
    await expect(page.getByRole('button', { name: /^Sleep after/ })).toBeDisabled()
  })

  test('SET-06 MODAL-03 connect a scale: list, disconnect, connect, cancel', async ({ page }) => {
    await open(page, 'Devices & water')
    await expect(page.getByTestId('scale-name')).toHaveText('Mock Scale')
    await page.getByRole('button', { name: 'Disconnect the scale' }).click()
    await expect(page.getByTestId('scale-name')).toHaveText('--')
    await page.getByRole('button', { name: 'Connect a scale' }).click()
    const modal = page.getByRole('dialog', { name: 'Connect a scale' })
    await expect(modal.getByRole('button', { name: 'Mock Scale' })).toBeVisible({ timeout: 15_000 })
    await modal.getByRole('button', { name: 'Mock Scale' }).click()
    await expect(modal).toBeHidden()
    await expect(page.getByTestId('scale-name')).toHaveText('Mock Scale', { timeout: 10_000 })
    await page.getByRole('button', { name: 'Connect a scale' }).click()
    await expect(modal.getByRole('button', { name: 'Mock Scale' })).toBeDisabled()
    await expect(modal).toContainText('CONNECTED')
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
  })

  test('MODAL-03 a failed connection says so and stays open', async ({ page }) => {
    await open(page, 'Devices & water')
    await page.getByRole('button', { name: 'Disconnect the scale' }).click()
    await expect(page.getByTestId('scale-name')).toHaveText('--')
    await page.route('**/api/v1/devices/connect', (r) => r.fulfill({ status: 500, json: { error: 'timeout' } }))
    await page.getByRole('button', { name: 'Connect a scale' }).click()
    const modal = page.getByRole('dialog', { name: 'Connect a scale' })
    await modal.getByRole('button', { name: 'Mock Scale' }).click({ timeout: 15_000 })
    await expect(modal.getByRole('alert')).toContainText("Couldn't connect to Mock Scale")
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'CANCEL' }).click()
    await expect(modal).toBeHidden()
  })

  test('SET-07 what the scale does when the machine sleeps', async ({ page }) => {
    await open(page, 'Devices & water')
    for (const [label, value] of [['Turn its display off', 'displayOff'], ['Leave it on', 'disabled'], ['Disconnect it', 'disconnect']]) {
      await page.getByRole('radio', { name: label }).click()
      await expect.poll(async () => (await settings()).scalePowerMode).toBe(value)
    }
  })

  test('SET-08 water warning level is set in % and sent in mm', async ({ page }) => {
    // The simulated machine ignores the level, so check what Mono sends: 20% of 2058 ml is closest to 15 mm (398 ml).
    const seen = writes(page)
    await open(page, 'Devices & water')
    await setValue(page, /^Warn when the tank is below/, 20)
    await expect.poll(() => seen).toContainEqual({ method: 'POST', path: '/api/v1/machine/waterLevels', body: { refillLevel: 6 } }) // 20% of 1453 ml is 291: 11 mm, less the 5 mm correction
  })

  test('SET-09 maintenance: release early cancels, hold starts cleaning', async ({ page }) => {
    await open(page, 'Maintenance')
    await page.getByRole('button', { name: 'Clean', exact: true }).click()
    await hold(page, 'HOLD TO CLEAN', 300)
    expect(await machineState()).toBe('idle')
    await page.getByRole('button', { name: 'NOT NOW' }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await page.getByRole('button', { name: 'Clean', exact: true }).click()
    await hold(page, 'HOLD TO CLEAN', 1_500)
    await waitForMachineState('cleaning')
    await expect(page.getByRole('button', { name: 'Descale', exact: true })).toBeDisabled()
    await expect(page.getByText('THE MACHINE MUST BE IDLE')).toBeVisible()
  })

  test('SET-10 firmware shows the installed build and an available update', async ({ page }) => {
    await open(page, 'Maintenance')
    await expect(page.getByTestId('fw-build')).toHaveText('Build 1337')
    await expect(page.getByTestId('fw-latest')).toHaveText('Build 1358')
    await expect(page.getByText("INSTALL FROM DECAID'S SETTINGS")).toBeVisible()
    await page.route('**/api/v1/machine/firmware', (r) => r.fulfill({ json: { machine: { model: 'DE1Pro', build: 1358 }, operation: { state: 'idle' }, recommendedArtifactId: 'de1-1358', updateAvailable: false } }))
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Maintenance', exact: true }).click()
    await expect(page.getByTestId('fw-latest')).toHaveCount(0)
  })

  test('SET-11 Mono look & sound is saved in the mono store', async ({ page }) => {
    await open(page, 'Look & sound')
    await page.getByRole('radio', { name: 'Teal' }).click()
    await expect.poll(async () => (await monoPrefs())?.accent).toBe('teal')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase())).toBe('#3d7f7a')
    await page.getByRole('radio', { name: '°F' }).click()
    await expect.poll(async () => (await monoPrefs())?.units).toBe('f')
    await page.getByRole('radio', { name: '12-HOUR' }).click()
    await expect.poll(async () => (await monoPrefs())?.clock).toBe('12')
    await page.getByRole('switch', { name: 'Play a sound when a shot finishes' }).click()
    await expect.poll(async () => (await monoPrefs())?.completionSound).toBe(true)
    await expect(page.getByTestId('language')).toHaveText('English')
    // °F shows on Home.
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByTestId('value-temp')).toContainText('°F')
  })

  for (const on of [true, false]) {
    test(`SET-12 completion sound ${on ? 'plays' : 'stays silent'} when a shot ends (${on ? 'on' : 'off'})`, async ({ page }) => {
      await decaid('POST', '/api/v1/store/mono/prefs', { completionSound: on })
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
      await page.getByRole('button', { name: 'BREW' }).click()
      await waitForMachineState('espresso')
      await page.waitForTimeout(3_000)
      await decaid('PUT', '/api/v1/machine/state/idle')
      await waitForMachineState('idle')
      // Decaid reports the shot finished only once the scale has settled, a few seconds after the stop.
      await expect(page.getByTestId('shot-done')).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => (window as unknown as { __monoChimes?: number }).__monoChimes ?? 0)).toBe(on ? 1 : 0)
    })
  }

  test('SET-13 extensions turn on and off', async ({ page }) => {
    // Faked: the simulator can't start plugins (no keyring), and turning one off is remembered by Decaid.
    let on = false
    const posts: string[] = []
    await page.route('**/api/v1/plugins', async (r) => {
      const list = await (await r.fetch()).json()
      await r.fulfill({ json: list.map((p: { id: string }) => (p.id === 'settings.reaplugin' ? { ...p, autoLoad: on, loaded: on } : p)) })
    })
    await page.route('**/api/v1/plugins/settings.reaplugin/*', (r) => { posts.push(new URL(r.request().url()).pathname); on = r.request().url().endsWith('/enable'); return r.fulfill({ json: { ok: true } }) })
    await open(page, 'System')
    const sw = page.getByRole('switch', { name: 'Settings Viewer' })
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(posts).toEqual(['/api/v1/plugins/settings.reaplugin/enable', '/api/v1/plugins/settings.reaplugin/disable'])
  })

  test('SET-13 a plugin that fails to turn on says so in plain words', async ({ page }) => {
    await page.route('**/api/v1/plugins/settings.reaplugin/enable', (r) => r.fulfill({ status: 500, json: { error: 'Failed to enable plugin: PlatformException(KeyringLocked, KeyringLocked, null, null)' } }))
    await page.route('**/api/v1/plugins', async (r) => {
      const list = await (await r.fetch()).json()
      await r.fulfill({ json: list.map((p: { id: string }) => (p.id === 'settings.reaplugin' ? { ...p, autoLoad: false, loaded: false } : p)) })
    })
    await open(page, 'System')
    await page.getByRole('switch', { name: 'Settings Viewer' }).click()
    await expect(page.getByText("Couldn't turn on Settings Viewer.")).toBeVisible()
    await expect(page.getByText(/Exception|Keyring/)).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Settings Viewer' })).toHaveAttribute('aria-checked', 'false')
  })

  test('SET-13 a plugin that is on but did not start is marked', async ({ page }) => {
    await page.route('**/api/v1/plugins', async (r) => {
      const list = await (await r.fetch()).json()
      await r.fulfill({ json: list.map((p: { id: string }) => (p.id === 'settings.reaplugin' ? { ...p, autoLoad: true, loaded: false } : p)) })
    })
    await open(page, 'System')
    await expect(page.getByRole('switch', { name: 'Settings Viewer' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.set-row', { has: page.getByRole('switch', { name: 'Settings Viewer' }) })).toContainText('FAILED TO START')
  })

  // The simulator can't read plugin settings (no keyring), so Decaid's replies are faked.
  // Text, number and password settings are rows; tapping one opens the text sheet.
  const field = (page: Page, label: string) => page.getByRole('dialog', { name: /settings$/ }).getByRole('button', { name: new RegExp(`^${label}:`) })
  async function typeInto(page: Page, label: string, value: string) {
    await field(page, label).click()
    const text = page.getByRole('dialog', { name: label.toUpperCase() })
    await text.getByTestId('text-input').fill(value)
    await text.getByRole('button', { name: 'DONE' }).click()
    await expect(text).toBeHidden()
  }

  test('SET-20 plugin settings: rows show saved values; save sends only changes; password stays hidden', async ({ page }) => {
    const sent: unknown[] = []
    await page.route('**/api/v1/plugins', async (r) => {
      const list = await (await r.fetch()).json()
      await r.fulfill({ json: list.map((p: { id: string; settings?: object }) => (p.id === 'time-to-ready.reaplugin' ? { ...p, settings: {} } : p.id === 'visualizer.reaplugin' ? { ...p, settings: { ...p.settings, Server: { type: 'enum', label: 'Server', values: ['visualizer.coffee', 'eu.visualizer.coffee'], default: 'visualizer.coffee' } } } : p)) })
    })
    await page.route('**/api/v1/plugins/visualizer.reaplugin/settings', (r) => {
      if (r.request().method() === 'POST') { sent.push(r.request().postDataJSON()); return r.fulfill({ json: {} }) }
      return r.fulfill({ json: { Username: 'jo@example.com', Password: { isSet: true }, AutoUpload: true, LengthThreshold: 5 } })
    })
    await open(page, 'System')
    await expect(page.getByRole('button', { name: 'Time To Ready settings' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Visualizer upload settings' }).click()
    const sheet = page.getByRole('dialog', { name: 'Visualizer upload settings' })
    await expect(field(page, 'Visualizer username')).toHaveAccessibleName('Visualizer username: jo@example.com')
    await expect(field(page, 'Visualizer password')).toHaveAccessibleName('Visualizer password: Saved')
    await expect(sheet.getByRole('switch', { name: 'Upload shots automatically' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByRole('radio', { name: 'visualizer.coffee', exact: true })).toHaveAttribute('aria-checked', 'true') // the default
    // A description that only repeats the label isn't shown.
    await expect(sheet).not.toContainText('Visualiser username')
    // Nothing changed: Save just closes.
    await sheet.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(sheet).toBeHidden()
    expect(sent).toEqual([])

    await page.getByRole('button', { name: 'Visualizer upload settings' }).click()
    await typeInto(page, 'Minimum shot length', '8s')
    await expect(sheet).toContainText('MINIMUM SHOT LENGTH: NUMBERS ONLY')
    await expect(sheet.getByRole('button', { name: 'SAVE', exact: true })).toBeDisabled()
    await typeInto(page, 'Minimum shot length', '8')
    await sheet.getByRole('switch', { name: 'Upload shots automatically' }).click()
    await sheet.getByRole('radio', { name: 'eu.visualizer.coffee' }).click()
    // The password sheet hides what's typed; the row then says it changed, never shows it.
    await field(page, 'Visualizer password').click()
    await expect(page.getByRole('dialog', { name: 'VISUALIZER PASSWORD' }).getByTestId('text-input')).toHaveAttribute('type', 'password')
    await page.keyboard.press('Escape') // closes only the password sheet
    await expect(sheet).toBeVisible()
    await typeInto(page, 'Visualizer password', '🔑 s3cret')
    await expect(field(page, 'Visualizer password')).toHaveAccessibleName('Visualizer password: Changed')
    await sheet.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByText('Visualizer upload settings saved')).toBeVisible()
    expect(sent).toEqual([{ LengthThreshold: 8, AutoUpload: false, Server: 'eu.visualizer.coffee', Password: '🔑 s3cret' }])

    await page.getByRole('button', { name: 'Visualizer upload settings' }).click()
    await sheet.getByRole('button', { name: 'Clear Visualizer password' }).click()
    await expect(field(page, 'Visualizer password')).toHaveAccessibleName('Visualizer password: Not set')
    await typeInto(page, 'Visualizer username', '')
    await expect(field(page, 'Visualizer username')).toHaveAccessibleName('Visualizer username: empty')
    await expect(field(page, 'Visualizer username')).toContainText('Tap to edit')
    await sheet.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect.poll(() => sent.length).toBe(2)
    expect(sent[1]).toEqual({ Password: null, Username: '' })
  })

  test('SET-20 plugin settings: long values fit; failures are plain; Cancel and Esc send nothing', async ({ page }) => {
    let posts = 0
    let failLoad = true
    const long = 'Supercalifragilisticexpialidocious-username-without-any-spaces@example.com ☕️🌱'
    await page.route('**/api/v1/plugins/visualizer.reaplugin/settings', (r) => {
      if (r.request().method() === 'POST') { posts++; return r.fulfill({ status: 400, json: { error: 'PluginSettingsValidationException: LengthThreshold must be a number' } }) }
      return failLoad ? r.fulfill({ status: 500, json: { error: 'KeyringLocked' } }) : r.fulfill({ json: { Username: long, Password: { isSet: false }, AutoUpload: false, LengthThreshold: 5 } })
    })
    await open(page, 'System')
    await page.getByRole('button', { name: 'Visualizer upload settings' }).click()
    const sheet = page.getByRole('dialog', { name: 'Visualizer upload settings' })
    await expect(sheet.getByRole('alert')).toHaveText(/Couldn't load these settings\./)
    await expect(page.getByText(/Keyring/)).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'SAVE' })).toHaveCount(0) // nothing to save until it loads
    await expect(sheet.getByRole('button', { name: 'CLOSE' })).toBeVisible()
    failLoad = false
    await sheet.getByRole('button', { name: 'TRY AGAIN' }).click()
    const user = field(page, 'Visualizer username')
    await expect(user).toHaveAccessibleName(`Visualizer username: ${long}`)
    const [ub, sb] = [(await user.boundingBox())!, (await sheet.boundingBox())!]
    expect(ub.x + ub.width).toBeLessThanOrEqual(sb.x + sb.width)
    await expect(field(page, 'Visualizer password')).toHaveAccessibleName('Visualizer password: Not set')
    await expect(sheet.getByRole('button', { name: 'Clear Visualizer password' })).toHaveCount(0)
    // Decaid rejects the save: a plain message, the sheet stays open.
    await typeInto(page, 'Minimum shot length', '9')
    await sheet.getByRole('button', { name: 'SAVE' }).click()
    await expect(page.getByText("Couldn't save Visualizer upload settings.")).toBeVisible()
    await expect(page.getByText(/Exception/)).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'CANCEL' }).click()
    await expect(sheet).toBeHidden()
    await page.getByRole('button', { name: 'Visualizer upload settings' }).click()
    await sheet.getByRole('switch', { name: 'Upload shots automatically' }).click()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    expect(posts).toBe(1)
  })

  test('SET-13 backup and logs download; restore asks first', async ({ page }) => {
    await open(page, 'System')
    await expect(page.getByTestId('app-version')).toHaveText(/\d+\.\d+/)
    const backup = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download a backup' }).click()
    expect((await backup).suggestedFilename()).toMatch(/^decaid-backup-\d{4}-\d{2}-\d{2}\.json$/)
    const logs = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download logs' }).click()
    expect((await logs).suggestedFilename()).toBe('decaid-logs.txt')
    // Restoring is faked: it would replace the simulator's data.
    let imported: unknown = null
    await page.route('**/api/v1/data/import', (r) => { imported = r.request().postDataJSON(); return r.fulfill({ json: { ok: true } }) })
    await page.getByTestId('restore-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from('{"profiles":[]}') })
    await expect(page.getByRole('alertdialog')).toContainText('with “backup.json”')
    await page.getByRole('button', { name: 'KEEP IT' }).click()
    expect(imported).toBeNull()
    await page.getByTestId('restore-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from('{"profiles":[]}') })
    await hold(page, 'HOLD TO RESTORE', 1_500)
    await expect.poll(() => imported).toEqual({ profiles: [] })
  })

  test('SET-14 switching skin asks first', async ({ page }) => {
    let body: unknown = null
    await page.route('**/api/v1/webui/skins/default', (r) => { body = r.request().postDataJSON(); return r.fulfill({ json: { ok: true } }) })
    await open(page, 'System')
    await expect(page.getByRole('radio', { name: /Mono/i })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('radio', { name: /Insight/ }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Switch to Insight?')
    await page.getByRole('button', { name: 'CANCEL' }).click()
    expect(body).toBeNull()
    await page.getByRole('radio', { name: /Insight/ }).click()
    await page.getByRole('button', { name: 'SWITCH' }).click()
    await expect.poll(() => body).toEqual({ skinId: 'insight' })
  })

  test('SET-16 machine settings write only their own key, temperatures in the chosen unit', async ({ page }) => {
    const machine = () => decaid<Record<string, number | boolean>>('GET', '/api/v1/machine/settings')
    const advanced = () => decaid<Record<string, number>>('GET', '/api/v1/machine/settings/advanced')
    const before = await machine()
    const seen = writes(page)
    await open(page, 'Machine')
    await page.getByRole('switch', { name: 'USB charging port' }).click()
    // The simulated machine ignores the USB port, so check what Mono sends.
    await expect.poll(() => seen.length).toBe(1)
    expect(seen).toEqual([{ method: 'POST', path: '/api/v1/machine/settings', body: { usb: !before.usb } }])
    await setValue(page, /^Fan turns on above/, 45)
    await expect.poll(async () => (await machine()).fan).toBe(45)
    await page.getByRole('radio', { name: 'TAP TWICE TO STOP' }).click()
    await expect.poll(async () => (await machine()).steamPurgeMode).toBe(1)
    await page.getByRole('radio', { name: 'NOT FITTED' }).click()
    await expect.poll(async () => (await advanced()).refillKitSetting).toBe(0)
    await setValue(page, /^Test time-out/, 8)
    await expect.poll(async () => (await advanced()).heaterPh2Timeout).toBe(8)
    // °F: shown converted, saved back in °C.
    await decaid('POST', '/api/v1/store/mono/prefs', { units: 'f' })
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Machine', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Fan turns on above/ })).toContainText(/113\s*°F/)
    await setValue(page, /^Fan turns on above/, 104)
    await expect.poll(async () => (await machine()).fan).toBe(40)
  })

  test('SET-17 night mode times and low-battery dimming', async ({ page }) => {
    await decaid('POST', '/api/v1/settings', { nightModeEnabled: false })
    await open(page, 'Sleep & display')
    await expect(page.getByRole('button', { name: /^Night starts/ })).toHaveCount(0)
    await page.getByRole('switch', { name: 'Night mode' }).click()
    await page.getByRole('button', { name: /^Night starts/ }).click()
    const sheet = page.getByRole('dialog', { name: 'NIGHT STARTS' })
    await sheet.getByRole('button', { name: 'Hour up' }).click()
    await sheet.getByRole('button', { name: 'Minute up' }).click()
    await sheet.getByRole('button', { name: 'DONE' }).click()
    const was = (await decaid<{ nightModeSleepTime: number }>('GET', '/api/v1/settings'))
    await expect(page.getByRole('button', { name: /^Night starts/ })).toBeVisible()
    expect(was.nightModeSleepTime % 5).toBe(0)
    await expect.poll(async () => (await settings()).nightModeSleepTime).not.toBe(1320)
    const before = (await settings()).lowBatteryBrightnessLimit
    await page.getByRole('switch', { name: 'Dim when the tablet battery is low' }).click()
    await expect.poll(async () => (await settings()).lowBatteryBrightnessLimit).toBe(!before)
  })

  test('SET-18 load a profile on wake: choose, then it loads when the machine wakes; clear', async ({ page, profiles }) => {
    const current = (await decaid<{ profile: { title: string } }>('GET', '/api/v1/workflow')).profile.title
    const other = profiles.find((p) => p.profile.title !== current)!
    await open(page, 'Sleep & display')
    await page.getByRole('button', { name: /^Load a profile on wake/ }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a profile' })
    await picker.getByLabel('Search profiles').fill(other.profile.title)
    await picker.getByRole('button', { name: other.profile.title, exact: true }).click()
    await expect.poll(async () => (await monoPrefs())?.wakeProfile).toBe(other.id)
    await expect(page.getByRole('button', { name: /^Load a profile on wake/ })).toContainText(other.profile.title)
    await decaid('PUT', '/api/v1/machine/state/sleeping')
    await waitForMachineState('sleeping')
    await decaid('PUT', '/api/v1/machine/state/idle')
    await expect.poll(async () => (await decaid<{ profile: { title: string } }>('GET', '/api/v1/workflow')).profile.title, { timeout: 10_000 }).toBe(other.profile.title)
    await page.getByRole('button', { name: /^Load a profile on wake/ }).click()
    await page.getByRole('dialog', { name: 'Choose a profile' }).getByRole('button', { name: 'NONE' }).click()
    await expect.poll(async () => (await monoPrefs())?.wakeProfile).toBe('')
  })

  test('SET-19 forget a scale asks first', async ({ page }) => {
    let sent: unknown = null
    await page.route('**/api/v1/devices/forget', (r) => { sent = r.request().postDataJSON(); return r.fulfill({ json: { ok: true } }) })
    await open(page, 'Devices & water')
    await page.getByRole('button', { name: 'Forget the scale' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Forget Mock Scale?')
    await page.getByRole('button', { name: 'CANCEL' }).click()
    expect(sent).toBeNull()
    await page.getByRole('button', { name: 'Forget the scale' }).click()
    await page.getByRole('button', { name: 'FORGET', exact: true }).click()
    await expect.poll(() => sent).toEqual({ deviceId: 'MockScale' })
  })

  test('SET-15 back returns Home from any section', async ({ page }) => {
    await open(page, 'Keyboard')
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })

  test('SET-15 the back button and title stay put while the section list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    await open(page)
    const back = page.getByRole('button', { name: 'Back to home' })
    const y = (await back.boundingBox())!.y
    const list = page.locator('.set-nav-list')
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect(page.getByRole('button', { name: 'System', exact: true })).toBeInViewport()
    expect((await back.boundingBox())!.y).toBe(y)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeInViewport()
  })
})

test.describe('Keyboard settings', () => {
  const home = async (page: Page) => {
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
    await page.locator('body').click({ position: { x: 600, y: 20 } })
  }

  test('KEY-12 rebind saves to Decaid, works at once and after reload', async ({ page }) => {
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await open(page, 'Keyboard')
    await page.getByRole('button', { name: 'Rebind Steam' }).click()
    await expect(page.getByTestId('capture')).toBeVisible()
    await page.keyboard.press('j')
    await expect(page.getByTestId('key-steam')).toHaveText('J')
    await expect.poll(async () => (await keyboard())?.actions.steam).toBe('j')
    await home(page)
    await page.keyboard.press('s')
    await page.waitForTimeout(500)
    expect(await machineState()).toBe('idle')
    await page.keyboard.press('j')
    await waitForMachineState('steam')
    await page.keyboard.press(' ')
    await waitForMachineState('idle')
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Keyboard', exact: true }).click()
    await expect(page.getByTestId('key-steam')).toHaveText('J')
  })

  test('KEY-13 a key in use asks to move it; cancel keeps both', async ({ page }) => {
    await open(page, 'Keyboard')
    await page.getByRole('button', { name: 'Rebind Flush' }).click()
    await page.keyboard.press('e')
    await expect(page.getByRole('alertdialog')).toContainText('E is already Espresso’s key')
    await page.getByRole('button', { name: 'CANCEL' }).click()
    await expect(page.getByTestId('key-flush')).toHaveText('F')
    await expect(page.getByTestId('key-espresso')).toHaveText('E')
    expect(await keyboard()).toBeNull()
    await page.getByRole('button', { name: 'Rebind Flush' }).click()
    await page.keyboard.press('e')
    await page.getByRole('button', { name: 'MOVE IT' }).click()
    await expect(page.getByTestId('key-flush')).toHaveText('E')
    await expect(page.getByTestId('key-espresso')).toHaveText('--')
    await expect.poll(async () => (await keyboard())?.actions).toMatchObject({ flush: 'e', espresso: '' })
  })

  test('KEY-14 Esc cancels a rebind', async ({ page }) => {
    await open(page, 'Keyboard')
    await page.getByRole('button', { name: 'Rebind Sleep' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('capture')).toBeHidden()
    await expect(page.getByTestId('key-sleep')).toHaveText('P')
    expect(await keyboard()).toBeNull()
  })

  test('KEY-15 add, change and remove a profile key', async ({ page, profiles }) => {
    const target = profiles.find((p) => p.profile.title !== '')!
    await open(page, 'Keyboard')
    await page.getByRole('button', { name: 'Add a profile key' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a profile' })
    await picker.getByLabel('Search profiles').fill(target.profile.title)
    await picker.getByRole('button', { name: target.profile.title, exact: true }).first().click() // earlier tests can leave a same-named copy
    await page.keyboard.press('1')
    await expect(page.getByTestId('profile-key')).toHaveCount(1)
    await expect(page.getByTestId('profile-key')).toContainText(target.profile.title)
    await expect.poll(async () => (await keyboard())?.profiles).toEqual({ 1: target.id })
    await page.getByRole('button', { name: `Change key for ${target.profile.title}` }).click()
    await page.keyboard.press('2')
    await expect.poll(async () => (await keyboard())?.profiles).toEqual({ 2: target.id })
    await page.getByRole('button', { name: 'Remove key 2' }).click()
    await expect(page.getByTestId('profile-key')).toHaveCount(0)
    await expect.poll(async () => (await keyboard())?.profiles).toEqual({})
  })

  test('KEY-16 reset to defaults after a hold', async ({ page }) => {
    await decaid('POST', '/api/v1/store/mono/keyboard', { enabled: true, actions: { espresso: 'q', hotWater: 'w', steam: 's', flush: 'f', stop: ' ', sleep: 'p' }, profiles: { 9: 'x' } })
    await open(page, 'Keyboard')
    await expect(page.getByTestId('key-espresso')).toHaveText('Q')
    await page.getByRole('button', { name: 'Reset shortcuts to defaults' }).click()
    await hold(page, 'HOLD TO RESET', 1_500)
    await expect(page.getByTestId('key-espresso')).toHaveText('E')
    await expect(page.getByTestId('profile-key')).toHaveCount(0)
    expect(await keyboard()).toBeNull()
  })

  test('KEY-12 turning shortcuts off stops them on Home', async ({ page }) => {
    await open(page, 'Keyboard')
    await page.getByRole('switch', { name: 'Use keyboard shortcuts' }).click()
    await expect.poll(async () => (await keyboard())?.enabled).toBe(false)
    await home(page)
    await page.keyboard.press('f')
    await page.waitForTimeout(600)
    expect(await machineState()).toBe('idle')
  })
})
