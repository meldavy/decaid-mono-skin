import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { expect, test, type ProfileRecord } from './fixtures'

// GLB-26: every element that renders a profile name or author, fed awkward strings.
const CASES = {
  long: 'Pour over basket/Cold brew 22g in, 375ml out — extended slow bloom',
  unbroken: 'Supercalifragilisticexpialidociousprofilenamewithoutanyspaces',
  emoji: '☕️ Señor Ristretto 浓缩咖啡 🌱🌱🌱 extra',
  empty: '',
}

async function arrange(page: Page, profiles: ProfileRecord[], title: string) {
  const fake = (r: ProfileRecord, i: number) => ({ ...r, profile: { ...r.profile, title: i === 0 ? title : `${title} ${i}`, author: `${title} author` } })
  const shown = profiles.slice(0, 3).map(fake)
  await page.route('**/api/v1/profiles', (route) => route.fulfill({ json: [...shown, ...profiles.slice(3)] }))
  await page.route('**/api/v1/store/streamline-app/favorite-profiles', (route) => route.fulfill({ json: { 0: shown[1].id, 1: shown[0].id, 2: shown[2].id, 3: null, 4: null } }))
  await page.route('**/api/v1/workflow', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const wf = await res.json()
    wf.profile = shown[0].profile
    await route.fulfill({ response: res, json: wf })
  })
  // Home's line under the name: when this profile was last brewed.
  await page.route('**/api/v1/shots?limit=100', (route) => route.fulfill({ json: { total: 1, items: [{ id: 'note', timestamp: new Date().toISOString(), workflow: { profile: { title } }, annotations: { enjoyment: 8, espressoNotes: title } }] } }))
}

const box = (page: Page, testId: string) => page.getByTestId(testId).first().boundingBox()
const lines = (el: Element) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
const overlaps = (a: DOMRect | { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

for (const [name, title] of Object.entries(CASES)) {
  test(`GLB-26 ${name} profile name: no growth, line limits, no collisions`, async ({ page, profiles }) => {
    await arrange(page, profiles, title)
    await page.goto('/')
    const main = page.getByTestId('main-card')
    await expect(main).toContainText('SELECTED')
    await expect(main).toContainText(title ? title.slice(0, 6) : 'Untitled')

    // Big card: fixed size, title ≤ 2 lines, last-shot line one line, no overlap with the chart.
    expect((await main.boundingBox())!.height).toBe(340)
    expect(await main.locator('.title').evaluate(lines)).toBeLessThanOrEqual(2)
    await expect(page.getByTestId('provenance')).toHaveText(title ? 'Last brewed today, rated 4/5' : 'Not brewed yet') // an untitled profile can't be matched to its shots
    expect(await page.getByTestId('provenance').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(30)
    expect(await page.getByTestId('provenance').evaluate((el) => el.scrollWidth <= el.parentElement!.clientWidth || getComputedStyle(el).overflow === 'hidden')).toBe(true)
    // Measured in one pass: the carousel may still be sliding.
    const geo = await main.evaluate((card) => {
      const r = (el: Element | null) => el!.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number; right: number; bottom: number }
      return { card: r(card), title: r(card.querySelector('.title')), chart: r(card.querySelector('[data-testid="dot-chart"]')) }
    })
    expect(overlaps(geo.title, geo.chart)).toBe(false)
    expect(geo.title.right).toBeLessThanOrEqual(geo.card.right)

    // Side cards: ≤ 3 lines, no overlap with their chart.
    for (const card of await page.locator('.card-side:not(.empty)').all()) {
      expect(await card.locator('.name').evaluate(lines)).toBeLessThanOrEqual(3)
      expect(overlaps((await card.locator('.name').boundingBox())!, (await card.getByTestId('dot-chart').boundingBox())!)).toBe(false)
    }

    // The display's profile name: at most two lines, a fixed height, so it never pushes the display.
    expect((await box(page, 'plan-title'))!.height).toBeLessThanOrEqual(34)

    // Ruler sheet heading: one line.
    await page.getByTestId('value-temp').click()
    expect((await box(page, 'sheet-focus-label'))!.height).toBeLessThan(20)
    await expect(page.getByTestId('sheet-focus-label')).toBeVisible()
    await decaid('GET', '/api/v1/devices') // keep the fixture's teardown symmetrical
  })
}
