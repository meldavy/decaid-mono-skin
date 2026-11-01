import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { currentTitle, expect, loadByApi, setFavourites, test, type ProfileRecord } from './fixtures'

type Step = { name: string; pump: string; pressure: number | null; flow: number | null; seconds: number; transition: string; limiter?: { value: number } | null; temperature?: number; sensor?: string; weight?: number; volume?: number; exit?: { type: string; condition: string; value: number } | null }
type Rec = ProfileRecord & { visibility: string; parentId?: string | null; profile: ProfileRecord['profile'] & { steps: Step[]; notes?: string; beverage_type?: string } }
const get = (id: string) => decaid<Rec>('GET', `/api/v1/profiles/${encodeURIComponent(id)}`)
const all = () => decaid<Rec[]>('GET', '/api/v1/profiles')
const editor = (page: Page) => page.getByTestId('editor')
const panel = (page: Page) => page.getByTestId('ed-panel')

let seq = 0
async function mine(title: string, base: ProfileRecord) {
  const p = base.profile as unknown as { steps: Step[] }
  const steps = p.steps.map((st, i) => (i === 0 ? { ...st, seconds: st.seconds + 0.53 + (seq++) * 0.01 } : st))
  return decaid<Rec>('POST', '/api/v1/profiles', { profile: { ...base.profile, title, steps } })
}

async function openEditor(page: Page, title: string, button: 'EDIT' | 'EDIT A COPY') {
  await page.goto('/')
  await page.getByRole('button', { name: 'All profiles' }).click()
  await page.getByTestId('library').getByRole('button', { name: title, exact: true }).click()
  await page.getByTestId('lib-detail').getByRole('button', { name: button, exact: true }).click()
  await expect(editor(page).getByTestId('ed-panel')).toBeVisible()
}

async function moveRuler(page: Page, slider: ReturnType<Page['getByRole']>, value: number) {
  await slider.focus()
  const now = Number(await slider.getAttribute('aria-valuenow'))
  const step = Number(await slider.getAttribute('data-step'))
  const presses = Math.round((value - now) / step)
  for (let i = 0; i < Math.abs(presses); i++) await page.keyboard.press(presses > 0 ? 'ArrowRight' : 'ArrowLeft')
}

// Duration, limit and the target have their ruler in the panel (limit also has OFF); every other value opens a sheet.
const INLINE: Record<string, RegExp> = { seconds: /^DURATION/, limit: /^MAX (PRESSURE|FLOW)/ }

async function setValue(page: Page, field: string, value: number | 'off') {
  if (INLINE[field]) {
    const panel = page.getByTestId('ed-panel')
    if (value === 'off') await page.getByTestId(`ed-field-${field}`).getByRole('button', { name: / off$/ }).click()
    else await moveRuler(page, panel.getByRole('slider', { name: INLINE[field] }), value)
    return
  }
  await page.getByTestId(`ed-field-${field}`).click()
  const sheet = page.getByRole('dialog')
  if (value === 'off') await sheet.getByRole('button', { name: 'OFF' }).click()
  else await moveRuler(page, sheet.getByRole('slider'), value)
  await sheet.getByRole('button', { name: 'DONE' }).click()
  await expect(sheet).toBeHidden()
}

async function hold(page: Page, name: string, ms: number) {
  const box = (await page.getByRole('button', { name }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

let profiles: ProfileRecord[]
let adaptive: ProfileRecord

test.describe('Editor', () => {
  test.beforeEach(async ({ profiles: p }) => {
    profiles = p
    adaptive = p.find((x) => x.profile.title === 'Adaptive v3') ?? p[0]
    await setFavourites(p.slice(0, 5).map((x) => x.id))
    await loadByApi(p[0])
  })

  test('EDIT-12 Type is a dropdown; the header fields keep their width whatever the type or version', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    const type = page.getByTestId('ed-type')
    const widths = async () => Promise.all(['ed-type', 'ed-yield', 'ed-version'].map(async (id) => (await page.getByTestId(id).boundingBox())!.width))
    const before = await widths()
    await type.click()
    const list = page.getByRole('listbox', { name: 'Type' })
    await expect(list.getByRole('option', { name: 'Espresso' })).toHaveAttribute('aria-selected', 'true')
    await list.getByRole('option', { name: 'Calibrate' }).click()
    await expect(list).toBeHidden()
    await expect(type).toContainText('Calibrate')
    await type.click()
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(type).toContainText('Calibrate')
    await page.getByTestId('ed-version').click()
    await page.getByTestId('text-input').fill('2.1-a-really-long-version-name')
    await page.getByRole('button', { name: 'DONE' }).click()
    expect(await widths()).toEqual(before)
  })

  test('EDIT-13 at 1000 × 600 the stage controls fit without scrolling, in named groups; the columns end together', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    const steps = (adaptive.profile as unknown as { steps: Step[] }).steps
    for (let i = 0; i < steps.length; i++) {
      await page.getByTestId(`ed-stage-${i}`).click()
      expect(await page.getByTestId('ed-panel').evaluate((el) => el.scrollHeight <= el.clientHeight + 1), `stage ${i + 1}`).toBe(true)
    }
    // Named groups: each group's content fits inside it, every group has its name, and the columns end together.
    const groups = await page.locator('.ed-group').evaluateAll((els) => els.map((g) => ({ fits: g.scrollHeight <= g.clientHeight + 1, named: !!g.querySelector('.ed-group-head'), bottom: Math.round(g.getBoundingClientRect().bottom) })))
    for (const g of groups) expect(g.fits && g.named).toBe(true)
    const ends = await page.locator('.ed-col').evaluateAll((els) => els.map((c) => Math.round(c.getBoundingClientRect().bottom)))
    expect(new Set(ends).size).toBe(1)
  })

  test('EDIT-14 the pressure / flow exit is one row; above or below is chosen in its sheet', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    await page.getByTestId('ed-stage-0').click() // Prefill: a flow stage, so its exit is on pressure
    const row = page.getByTestId('ed-field-exitPressure')
    await row.click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('group', { name: 'Above or below' }).getByRole('button', { name: 'BELOW' }).click()
    await sheet.getByRole('button', { name: 'Increase' }).click()
    await sheet.getByRole('button', { name: 'DONE' }).click()
    await expect(row).toContainText('PRESSURE BELOW')
    await row.click()
    await expect(sheet.getByRole('group', { name: 'Above or below' }).getByRole('button', { name: 'BELOW' })).toHaveAttribute('aria-pressed', 'true')
    await sheet.getByRole('button', { name: 'OFF' }).click()
    await sheet.getByRole('button', { name: 'DONE' }).click()
    await expect(row).toContainText('--')
    await expect(row).not.toContainText('BELOW')
  })

  test('EDIT-11 many stages: each keeps room for its name; chart and stages scroll together under a fixed scale', async ({ page, profiles }) => {
    const weber = profiles.find((p) => p.profile.title === 'Cleaning/Weber Spring Clean')
    test.skip(!weber, 'needs the Weber Spring Clean built-in')
    await openEditor(page, weber!.profile.title, 'EDIT A COPY')
    const lis = editor(page).locator('.ed-axis li')
    await expect(lis).toHaveCount(15)
    for (const li of await lis.all()) expect((await li.boundingBox())!.width).toBeGreaterThanOrEqual(143.5)
    const scroll = page.getByTestId('ed-scroll')
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const axisX = (await page.getByTestId('chart-axis').boundingBox())!.x
    // Choosing the last stage brings it into view; the scale doesn't move.
    await page.getByTestId('ed-stage-14').click()
    await expect(panel(page)).toContainText('STAGE 15 NAME')
    await expect.poll(async () => {
      const [s, b] = [(await scroll.boundingBox())!, (await page.getByTestId('ed-stage-14').boundingBox())!]
      return b.x >= s.x - 1 && b.x + b.width <= s.x + s.width + 1
    }).toBe(true)
    expect((await page.getByTestId('chart-axis').boundingBox())!.x).toBe(axisX)
    // The highlight band sits over the selected stage.
    const [band, last] = [(await editor(page).locator('.ed-band').boundingBox())!, (await page.getByTestId('ed-stage-14').boundingBox())!]
    expect(Math.abs(band.x - last.x)).toBeLessThan(2)
    // Tapping the chart selects the stage under the finger.
    const chart = (await page.getByTestId('ed-chart').boundingBox())!
    const prev = (await page.getByTestId('ed-stage-13').boundingBox())!
    await page.mouse.click(prev.x + 10, chart.y + chart.height / 2)
    await expect(page.getByTestId('ed-stage-13')).toHaveAttribute('aria-pressed', 'true')
  })

  test('EDIT-01 the stage axis lines up under the chart; tapping a stage or the chart selects it', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    const steps = (adaptive.profile as unknown as { steps: Step[] }).steps
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(steps.length)
    await page.getByTestId('ed-stage-2').click()
    await expect(panel(page)).toContainText(`STAGE 3 NAME${steps[2].name}`)
    const chart = (await page.getByTestId('ed-chart').boundingBox())!
    const first = (await page.getByTestId('ed-stage-0').boundingBox())!
    await page.mouse.click(first.x + 4, chart.y + chart.height / 2)
    await expect(page.getByTestId('ed-stage-0')).toHaveAttribute('aria-pressed', 'true')
    // the axis and the chart start at the same x (after the y-axis labels)
    const axisStart = first.x
    const band = (await editor(page).locator('.ed-band').boundingBox())!
    expect(Math.abs(band.x - axisStart)).toBeLessThan(2)
  })

  test('EDIT-02 every stage setting edits the draft', async ({ page }) => {
    const own = await mine('Mono ed fields', adaptive)
    await openEditor(page, 'Mono ed fields', 'EDIT')
    await page.getByTestId('ed-stage-2').click() // Compressing: pressure
    await panel(page).getByRole('group', { name: 'CONTROL' }).getByRole('button', { name: 'FLOW' }).click()
    await expect(panel(page)).toContainText('FLOW AT END OF STAGE')
    await panel(page).getByRole('group', { name: 'TRANSITION' }).getByRole('button', { name: 'SMOOTH' }).click()
    await panel(page).getByRole('group', { name: 'MEASURE FROM' }).getByRole('button', { name: 'WATER' }).click()
    await setValue(page, 'seconds', 15)
    await setValue(page, 'limit', 3) // on first, so turning it off is a real change
    await setValue(page, 'limit', 'off')
    await setValue(page, 'exitWeight', 4)
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    const saved = (await all()).find((r) => r.profile.title === 'Mono ed fields')!
    const st = saved.profile.steps[2]
    expect([st.pump, st.transition, st.sensor, st.seconds, st.limiter?.value ?? 0, st.weight]).toEqual(['flow', 'smooth', 'water', 15, 0, 4])
    expect(saved.id).not.toBe(own.id) // a recipe change makes it a new profile id in Decaid
  })

  test('EDIT-03 values keep to their limits; a stage that would end at once can\'t be saved', async ({ page }) => {
    await mine('Mono ed limits', adaptive)
    await openEditor(page, 'Mono ed limits', 'EDIT')
    await page.getByTestId('ed-stage-0').click()
    await page.getByTestId('ed-field-temperature').click()
    const slider = page.getByRole('dialog').getByRole('slider')
    expect([await slider.getAttribute('aria-valuemin'), await slider.getAttribute('aria-valuemax')]).toEqual(['80', '105'])
    await page.getByRole('button', { name: 'CANCEL' }).click()
    await setValue(page, 'seconds', 0)
    await setValue(page, 'exitVolume', 'off')
    // With no duration and nothing to move on, the stage would end at once
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('ed-problem')).toContainText('Stage 1 has no duration')
    await expect(editor(page)).toBeVisible()
  })

  test('EDIT-04 add a stage after the selected one; delete needs a hold; the last stage can\'t be deleted', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    const n = (adaptive.profile as unknown as { steps: Step[] }).steps.length
    await page.getByTestId('ed-stage-1').click()
    await page.getByRole('button', { name: 'STAGE', exact: true }).click()
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(n + 1)
    await expect(page.getByTestId('ed-stage-2')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'DELETE STAGE' }).click()
    await hold(page, 'HOLD TO DELETE', 300)
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(n + 1)
    await hold(page, 'HOLD TO DELETE', 1_500)
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(n)
    for (let i = n; i > 1; i--) {
      await page.getByRole('button', { name: 'DELETE STAGE' }).click()
      await hold(page, 'HOLD TO DELETE', 1_400)
    }
    await expect(page.getByRole('button', { name: 'DELETE STAGE' })).toBeDisabled()
  })

  test('EDIT-05 hold a stage and drag it to reorder; ← / → select the previous / next stage', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    const names = (adaptive.profile as unknown as { steps: Step[] }).steps.map((s) => s.name)
    const a = (await page.getByTestId('ed-stage-0').boundingBox())!
    const c = (await page.getByTestId('ed-stage-2').boundingBox())!
    // A quick drag is a scroll: nothing moves.
    await page.mouse.move(a.x + 20, a.y + 20)
    await page.mouse.down()
    await page.mouse.move(c.x + 40, a.y + 20, { steps: 6 })
    await page.mouse.up()
    await expect(page.getByTestId('ed-stage-0')).toContainText(names[0])
    // Hold, then drag: the first stage lands third and stays selected.
    await page.mouse.move(a.x + 20, a.y + 20)
    await page.mouse.down()
    await page.waitForTimeout(450)
    await page.mouse.move(c.x + 40, a.y + 20, { steps: 8 })
    await expect(page.getByTestId('ed-drop')).toBeVisible()
    await page.mouse.up()
    await expect(page.getByTestId('ed-stage-2')).toContainText(names[0])
    await expect(page.getByTestId('ed-stage-0')).toContainText(names[1])
    await expect(page.getByTestId('ed-stage-2')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Previous stage' }).click()
    await expect(page.getByTestId('ed-stage-1')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Next stage' }).click()
    await page.getByRole('button', { name: 'Next stage' }).click()
    await expect(page.getByTestId('ed-stage-3')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('ed-stage-3')).toContainText(names[3]) // selecting moves nothing
  })

  test('EDIT-06 rename the profile and a stage; add notes', async ({ page }) => {
    await mine('Mono ed rename', adaptive)
    await openEditor(page, 'Mono ed rename', 'EDIT')
    await editor(page).getByRole('button', { name: /^Name:/ }).click()
    await page.getByTestId('text-input').fill('Mono ed renamed')
    await page.getByRole('button', { name: 'DONE' }).click()
    await page.getByRole('button', { name: /^Stage 1 name/ }).click()
    await page.getByTestId('text-input').fill('First drip')
    await page.keyboard.press('Enter')
    await editor(page).getByRole('button', { name: /^NOTES/ }).click()
    await page.getByTestId('text-input').fill('Notes from the editor')
    await page.getByRole('button', { name: 'DONE' }).click()
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    const saved = (await all()).find((r) => r.profile.title === 'Mono ed renamed')!
    expect(saved.profile.steps[0].name).toBe('First drip')
    expect(saved.profile.notes).toBe('Notes from the editor')
  })

  test('EDIT-07 renaming keeps the same profile; a changed recipe carries its favourite slot to the new id', async ({ page }) => {
    const own = await mine('Mono ed keep', adaptive)
    await setFavourites([own.id, profiles[1].id, null, null, null])
    await openEditor(page, 'Mono ed keep', 'EDIT')
    await editor(page).getByRole('button', { name: /^Name:/ }).click()
    await page.getByTestId('text-input').fill('Mono ed kept')
    await page.getByRole('button', { name: 'DONE' }).click()
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect.poll(async () => (await get(own.id)).profile.title).toBe('Mono ed kept')
    await openEditor(page, 'Mono ed kept', 'EDIT')
    await setValue(page, 'temperature', 90)
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    const fresh = (await all()).find((r) => r.profile.title === 'Mono ed kept')!
    expect(fresh.id).not.toBe(own.id)
    expect((await decaid<Record<string, string | null>>('GET', '/api/v1/store/streamline-app/favorite-profiles'))['0']).toBe(fresh.id)
  })

  test('EDIT-08 saving a changed copy of a built-in makes a new profile; its favourite slot follows', async ({ page }) => {
    await setFavourites([adaptive.id, null, null, null, null])
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    await expect(editor(page)).toContainText('COPY · NOT SAVED')
    await setValue(page, 'temperature', 92)
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    const copy = (await all()).find((r) => r.profile.title === `${adaptive.profile.title} — my copy`)!
    expect(copy.isDefault).toBe(false)
    expect((await get(adaptive.id)).visibility).toBe('visible') // original kept
    expect((await decaid<Record<string, string | null>>('GET', '/api/v1/store/streamline-app/favorite-profiles'))['0']).toBe(copy.id)
  })

  test('EDIT-08 an unchanged copy saves as your own (its version differs); with the original version it says it\'s the same', async ({ page }) => {
    const v = String((adaptive.profile as unknown as { version?: string }).version ?? '2')
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    await expect(page.getByTestId('ed-version')).not.toContainText(new RegExp(`^VERSION${v.replace('.', '\\.')}$`))
    await page.getByTestId('ed-version').click()
    await page.getByTestId('text-input').fill(v)
    await page.getByRole('button', { name: 'DONE' }).click()
    const before = (await all()).length
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('ed-problem')).toContainText('Same recipe and version')
    expect((await all()).length).toBe(before)
    await page.getByTestId('ed-version').click()
    await page.getByTestId('text-input').fill(`${v}.9`)
    await page.getByRole('button', { name: 'DONE' }).click()
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    const copy = (await all()).find((r) => r.profile.title === `${adaptive.profile.title} — my copy`)! as unknown as { profile: { version: string; steps: unknown[] } }
    expect(copy.profile.version).toBe(`${v}.9`)
    expect(JSON.stringify(copy.profile.steps)).toBe(JSON.stringify((adaptive.profile as unknown as { steps: unknown[] }).steps))
  })

  test('EDIT-09 Reset to original loads the original recipe into the draft', async ({ page }) => {
    await openEditor(page, adaptive.profile.title, 'EDIT A COPY')
    await page.getByTestId('ed-stage-0').click()
    await page.getByRole('button', { name: 'DELETE STAGE' }).click()
    await hold(page, 'HOLD TO DELETE', 1_400)
    const n = (adaptive.profile as unknown as { steps: Step[] }).steps.length
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(n - 1)
    await page.getByRole('button', { name: 'RESET TO ORIGINAL' }).click()
    await expect(editor(page).locator('.ed-axis li')).toHaveCount(n)
  })

  test('EDIT-10 MODAL-04 Back with unsaved changes: Keep editing / Discard / Save', async ({ page }) => {
    await mine('Mono ed leave', adaptive)
    await openEditor(page, 'Mono ed leave', 'EDIT')
    await page.getByTestId('ed-stage-1').click()
    await panel(page).getByRole('group', { name: 'TRANSITION' }).getByRole('button', { name: 'SMOOTH' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    const d = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(d).toContainText('transition')
    await d.getByRole('button', { name: 'KEEP EDITING' }).click()
    await expect(editor(page)).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await d.getByRole('button', { name: 'DISCARD' }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    expect((await all()).find((r) => r.profile.title === 'Mono ed leave')!.profile.steps[1].transition).toBe('fast')
  })

  test('EDIT-11 a failed save says so and keeps the edits', async ({ page }) => {
    await mine('Mono ed fail', adaptive)
    await openEditor(page, 'Mono ed fail', 'EDIT')
    await page.route('**/api/v1/profiles/*', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{"error":"disk full"}' }) : route.continue()))
    await setValue(page, 'temperature', 91)
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('disk full')
    await expect(editor(page)).toBeVisible()
    await expect(page.getByTestId('ed-field-temperature')).toContainText('91.0')
  })

  test('EDIT-12 saving the profile that is on the machine updates the machine', async ({ page }) => {
    const own = await mine('Mono ed machine', adaptive)
    await loadByApi(own)
    await openEditor(page, 'Mono ed machine', 'EDIT')
    await editor(page).getByRole('button', { name: /^Name:/ }).click()
    await page.getByTestId('text-input').fill('Mono ed on machine')
    await page.getByRole('button', { name: 'DONE' }).click()
    await page.getByRole('button', { name: 'SAVE', exact: true }).click()
    await expect.poll(currentTitle).toBe('Mono ed on machine')
  })

  test('GLB-26 long profile and stage names stay inside the editor', async ({ page }) => {
    const own = await mine('Supercalifragilistic expialidocious profile with a very long name indeed', adaptive)
    await openEditor(page, own.profile.title, 'EDIT')
    await page.getByRole('button', { name: /^Stage 1 name/ }).click()
    await page.getByTestId('text-input').fill('Supercalifragilisticexpialidociousstagename')
    await page.getByRole('button', { name: 'DONE' }).click()
    const title = editor(page).locator('.ed-title-name')
    expect(await title.evaluate((el) => el.getBoundingClientRect().height < 50 && el.scrollWidth >= el.clientWidth)).toBe(true)
    const header = (await editor(page).locator('.ed-header').boundingBox())!
    expect(header.height).toBeLessThan(80)
    for (const n of await editor(page).locator('.ed-axis-name').all()) expect((await n.boundingBox())!.height).toBeLessThan(30)
  })
})
