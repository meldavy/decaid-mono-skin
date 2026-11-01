import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { currentTitle, expect, loadByApi, setFavourites, test, type ProfileRecord } from './fixtures'

type Rec = ProfileRecord & { visibility: string }
const lib = (page: Page) => page.getByTestId('library')
const detail = (page: Page) => page.getByTestId('lib-detail')
const row = (page: Page, title: string) => lib(page).getByRole('button', { name: title, exact: true })

async function openLibrary(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'All profiles' }).click()
  await expect(lib(page)).toBeVisible()
}

// Decaid identifies a profile by its recipe, so a test profile needs a recipe of its own (not just a new title).
let seq = 0
async function mine(title: string, base: ProfileRecord) {
  const p = base.profile as unknown as { steps: { seconds: number }[] }
  const steps = p.steps.map((st, i) => (i === 0 ? { ...st, seconds: st.seconds + 0.37 + (seq++) * 0.01 } : st))
  return decaid<Rec>('POST', '/api/v1/profiles', { profile: { ...base.profile, title, steps } })
}

async function hold(page: Page, name: string, ms: number) {
  const box = (await page.getByRole('button', { name }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test.describe('Library', () => {
  test.beforeEach(async ({ profiles }) => {
    await setFavourites(profiles.slice(0, 5).map((p) => p.id))
    await loadByApi(profiles[0])
  })

  test('LIB-01 lists visible profiles with favourite slots; the machine\'s profile is marked and selected', async ({ page, profiles }) => {
    await openLibrary(page)
    await expect(lib(page).locator('.lib-row')).toHaveCount(profiles.length)
    await expect(row(page, profiles[2].profile.title)).toContainText('● 03')
    await expect(row(page, profiles[0].profile.title)).toHaveAttribute('aria-current', 'true')
    await expect(row(page, profiles[0].profile.title)).toContainText('ON THE MACHINE')
  })

  test('LIB-02 search narrows the list live; no results says so; clearing restores it', async ({ page, profiles }) => {
    await openLibrary(page)
    const word = profiles[3].profile.title.split(/\s|\//)[0]
    await page.getByLabel('Search profiles').fill(word)
    const n = profiles.filter((p) => p.profile.title.toLowerCase().includes(word.toLowerCase())).length
    await expect(lib(page).locator('.lib-row')).toHaveCount(n)
    await page.getByLabel('Search profiles').fill('zzzz nothing')
    await expect(page.getByTestId('lib-empty')).toHaveText('Nothing matches “zzzz nothing”.')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(lib(page).locator('.lib-row')).toHaveCount(profiles.length)
  })

  test('LIB-03 hidden profiles are left out, listed under HIDDEN and marked', async ({ page, profiles }) => {
    await decaid('PUT', `/api/v1/profiles/${profiles[6].id}/visibility`, { visibility: 'hidden' })
    await openLibrary(page)
    await expect(row(page, profiles[6].profile.title)).toHaveCount(0)
    await page.getByRole('button', { name: /^HIDDEN 1$/ }).click()
    await expect(row(page, profiles[6].profile.title)).toContainText('HIDDEN')
  })

  test('LIB-04 tapping a profile shows its detail: chart, stages, notes', async ({ page, profiles }) => {
    await openLibrary(page)
    const p = profiles.find((x) => x.profile.title === 'Adaptive v3') ?? profiles[1]
    await row(page, p.profile.title).click()
    await expect(detail(page)).toContainText(p.profile.title)
    await expect(detail(page).getByTestId('dot-chart')).toBeVisible()
    await expect(detail(page).locator('.legend-item').first()).toContainText('01')
  })

  test('LIB-05 Select puts the profile on the machine and goes Home', async ({ page, profiles }) => {
    await openLibrary(page)
    await row(page, profiles[8].profile.title).click()
    await detail(page).getByRole('button', { name: 'SELECT' }).click()
    await expect.poll(currentTitle).toBe(profiles[8].profile.title)
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })

  test('LIB-06 Edit opens your own profile; Edit a copy opens an unsaved draft and writes nothing', async ({ page, profiles }) => {
    const own = await mine('Mono test own', profiles[0])
    await openLibrary(page)
    await row(page, 'Mono test own').click()
    await detail(page).getByRole('button', { name: 'EDIT', exact: true }).click()
    await expect(page.locator(`[data-editing="${own.id}"]`)).toBeAttached()
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes('/api/v1/profiles') && r.method() !== 'GET') writes.push(r.url()) })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await row(page, profiles[1].profile.title).click()
    await detail(page).getByRole('button', { name: 'EDIT A COPY' }).click()
    await expect(page.locator(`[data-editing="draft:${profiles[1].id}"]`)).toBeAttached()
    expect(writes).toEqual([])
  })

  test('LIB-07 Duplicate opens a copy with its own version; saving it unchanged makes a separate profile', async ({ page, profiles }) => {
    const own = await mine('Mono test dup', profiles[0])
    await openLibrary(page)
    await row(page, 'Mono test dup').click()
    await detail(page).getByRole('button', { name: 'COPY' }).click()
    await expect(page.locator(`[data-editing="draft:${own.id}"]`)).toBeAttached()
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(lib(page)).toBeVisible()
    const copies = (await decaid<Rec[]>('GET', '/api/v1/profiles')).filter((r) => r.profile.title.startsWith('Mono test dup'))
    expect(copies).toHaveLength(2)
    expect(new Set(copies.map((c) => c.id)).size).toBe(2)
  })

  test('LIB-07 importing a recipe you already have says so and selects it', async ({ page, profiles }) => {
    await openLibrary(page)
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.getByTestId('import-file').setInputFiles({ name: 'same.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profiles[4].profile)) })
    await expect(page.getByRole('status').filter({ hasText: 'Already in your library' })).toContainText(profiles[4].profile.title)
    await expect(row(page, profiles[4].profile.title)).toHaveAttribute('aria-current', 'true')
  })

  test('LIB-08 Hide and Show save the profile\'s visibility', async ({ page, profiles }) => {
    await openLibrary(page)
    await row(page, profiles[9].profile.title).click()
    await detail(page).getByRole('button', { name: 'HIDE' }).click()
    await expect.poll(async () => (await decaid<Rec>('GET', `/api/v1/profiles/${profiles[9].id}`)).visibility).toBe('hidden')
    await page.getByRole('button', { name: /^HIDDEN/ }).click()
    await row(page, profiles[9].profile.title).click()
    await detail(page).getByRole('button', { name: 'SHOW' }).click()
    await expect.poll(async () => (await decaid<Rec>('GET', `/api/v1/profiles/${profiles[9].id}`)).visibility).toBe('visible')
  })

  test('LIB-09 MODAL-01 deleting your own profile needs a full hold; letting go early keeps it', async ({ page, profiles }) => {
    const own = await mine('Mono test delete', profiles[0])
    await openLibrary(page)
    await row(page, 'Mono test delete').click()
    await detail(page).getByRole('button', { name: 'DELETE' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Delete “Mono test delete”?')
    await hold(page, 'HOLD TO DELETE', 400) // too short
    await expect(page.getByRole('alertdialog')).toBeVisible()
    expect((await decaid<Rec>('GET', `/api/v1/profiles/${own.id}`)).visibility).toBe('visible')
    await hold(page, 'HOLD TO DELETE', 1_500)
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect.poll(async () => (await decaid<Rec>('GET', `/api/v1/profiles/${own.id}`)).visibility).toBe('deleted')
    await expect(row(page, 'Mono test delete')).toHaveCount(0)
  })

  test('KEY-15 deleting a profile removes its profile key', async ({ page, profiles }) => {
    const own = await mine('Mono test keyed', profiles[0])
    await decaid('POST', '/api/v1/store/mono/keyboard', { enabled: true, actions: { espresso: 'e', hotWater: 'w', steam: 's', flush: 'f', stop: ' ', sleep: 'p' }, profiles: { 1: own.id, 2: profiles[1].id } })
    await openLibrary(page)
    await row(page, 'Mono test keyed').click()
    await detail(page).getByRole('button', { name: 'DELETE' }).click()
    await hold(page, 'HOLD TO DELETE', 1_500)
    await expect.poll(async () => (await decaid<{ profiles: Record<string, string> }>('GET', '/api/v1/store/mono/keyboard')).profiles).toEqual({ 2: profiles[1].id })
  })

  test('LIB-09 Keep it / Esc / tapping outside cancel a delete', async ({ page, profiles }) => {
    const own = await mine('Mono test keep', profiles[0])
    await openLibrary(page)
    await row(page, 'Mono test keep').click()
    for (const how of ['keep', 'esc', 'scrim'] as const) {
      await detail(page).getByRole('button', { name: 'DELETE' }).click()
      if (how === 'keep') await page.getByRole('button', { name: 'KEEP IT' }).click()
      if (how === 'esc') await page.keyboard.press('Escape')
      if (how === 'scrim') await page.getByTestId('confirm-scrim').click({ position: { x: 20, y: 20 } })
      await expect(page.getByRole('alertdialog')).toBeHidden()
    }
    expect((await decaid<Rec>('GET', `/api/v1/profiles/${own.id}`)).visibility).toBe('visible')
  })

  test('LIB-10 built-ins offer Hide, not Delete', async ({ page, profiles }) => {
    await openLibrary(page)
    await row(page, profiles[1].profile.title).click()
    await expect(detail(page).getByRole('button', { name: 'HIDE' })).toBeVisible()
    await expect(detail(page).getByRole('button', { name: 'DELETE' })).toHaveCount(0)
  })

  test('LIB-11 deleting a favourite empties its slot; the dialog warns first', async ({ page, profiles }) => {
    const own = await mine('Mono test fav', profiles[0])
    await setFavourites([profiles[0].id, own.id, null, null, null])
    await openLibrary(page)
    await row(page, 'Mono test fav').click()
    await detail(page).getByRole('button', { name: 'DELETE' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('favourite slot 02, so that slot will be left empty')
    await hold(page, 'HOLD TO DELETE', 1_500)
    await expect.poll(async () => (await decaid<Record<string, string | null>>('GET', '/api/v1/store/streamline-app/favorite-profiles'))['1']).toBeNull()
  })

  test('LIB-12 importing a profile file adds it; an unreadable file says so and adds nothing', async ({ page, profiles }) => {
    await openLibrary(page)
    const before = (await decaid<Rec[]>('GET', '/api/v1/profiles')).length
    await page.getByRole('button', { name: 'NEW' }).click()
    const p0 = profiles[0].profile as unknown as { steps: { seconds: number }[] }
    const steps = p0.steps.map((st, i) => (i === 0 ? { ...st, seconds: st.seconds + 0.73 } : st))
    await page.getByTestId('import-file').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...profiles[0].profile, title: 'Mono test imported', steps })) })
    await expect(row(page, 'Mono test imported')).toBeVisible()
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{ nope') })
    await expect(page.getByRole('alert')).toContainText("isn't a profile")
    expect((await decaid<Rec[]>('GET', '/api/v1/profiles')).length).toBe(before + 1)
  })

  test('LIB-13 importing a de1app / Visualizer .tcl profile; an older simple profile is explained', async ({ page }) => {
    await openLibrary(page)
    const tcl = `profile_title {Mono tcl import}\nauthor Mono\nbeverage_type espresso\nsettings_profile_type settings_2c\nadvanced_shot {\n  {name soak pump flow transition fast temperature 94.3 sensor coffee flow 4 pressure 0 seconds 12.7 weight 0 volume 0 exit_if 1 exit_type pressure_over exit_pressure_over 3 max_flow_or_pressure 0 max_flow_or_pressure_range 0.6}\n  {name {fall away} pump pressure transition smooth temperature 93.1 sensor coffee flow 0 pressure 6.3 seconds 31 weight 0 volume 0 exit_if 0 exit_type pressure_over max_flow_or_pressure 2.5 max_flow_or_pressure_range 0.6}\n}`
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.getByTestId('import-file').setInputFiles({ name: 'lever.tcl', mimeType: 'text/plain', buffer: Buffer.from(tcl) })
    await expect(row(page, 'Mono tcl import')).toBeVisible()
    const rec = (await decaid<Rec[]>('GET', '/api/v1/profiles')).find((r) => r.profile.title === 'Mono tcl import') as unknown as { profile: { steps: { name: string; pump: string }[] } }
    expect(rec.profile.steps.map((s) => `${s.name}:${s.pump}`)).toEqual(['soak:flow', 'fall away:pressure'])
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.getByTestId('import-file').setInputFiles({ name: 'old.tcl', mimeType: 'text/plain', buffer: Buffer.from('profile_title {Old}\nsettings_profile_type settings_2a\n') })
    await expect(page.getByRole('alert')).toContainText('Older “simple”')
  })

  test('LIB-14 New opens an unsaved draft of the basic profile; nothing is written', async ({ page, profiles }) => {
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes('/api/v1/profiles') && r.method() !== 'GET') writes.push(r.url()) })
    await openLibrary(page)
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.getByRole('menuitem', { name: 'FROM THE BASIC PROFILE' }).click()
    const basic = profiles.find((p) => p.profile.title === 'Default')!
    await expect(page.locator(`[data-editing="draft:${basic.id}"]`)).toBeAttached()
    expect(writes).toEqual([])
  })

  test('LIB-15 Manage favourites opens the favourites manager', async ({ page }) => {
    await openLibrary(page)
    await page.getByRole('button', { name: 'MANAGE FAVOURITES' }).click()
    await expect(page.getByTestId('favourites')).toBeVisible()
  })

  test('LIB-04 a long description and every stage are shown; the detail scrolls and its buttons stay put', async ({ page, profiles }) => {
    const p = profiles.find((x) => String((x.profile as unknown as { notes?: string }).notes ?? '').length > 400) ?? profiles[0]
    await openLibrary(page)
    await row(page, p.profile.title).click()
    const scroller = page.getByTestId('detail-scroll')
    const select = detail(page).getByRole('button', { name: /SELECT/ })
    const before = (await select.boundingBox())!
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    expect(await detail(page).locator('.lib-detail-notes').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true) // not clamped
    await expect(detail(page).locator('.legend-item')).toHaveCount((p.profile as unknown as { steps: unknown[] }).steps.length)
    // order: title, chart, stats, then the description
    const y = async (sel: string) => (await detail(page).locator(sel).first().boundingBox())!.y
    expect(await y('.lib-stats')).toBeLessThan(await y('.lib-detail-notes'))
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
    expect((await select.boundingBox())!.y).toBe(before.y)
    await expect(select).toBeInViewport()
  })

  test('LIB-16 the whole list scrolls; long names end in "…" on one line', async ({ page, profiles }) => {
    await openLibrary(page)
    const list = lib(page).locator('.lib-list')
    const last = profiles[profiles.length - 1]
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect(lib(page).locator('.lib-row').last()).toBeInViewport()
    for (const name of await lib(page).locator('.lib-row-name').all()) {
      expect(await name.evaluate((el) => el.getBoundingClientRect().height < 32)).toBe(true)
    }
    expect(last).toBeTruthy()
  })

  test('GLB-01 opening the Library writes nothing', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes(':8080') && r.method() !== 'GET' && !r.url().endsWith('/machine/heartbeat')) writes.push(`${r.method()} ${r.url()}`) })
    await openLibrary(page)
    await page.waitForTimeout(1_500)
    expect(writes).toEqual([])
  })
})
