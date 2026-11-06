import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { currentTitle, expect, test } from './fixtures'

type Shot = { id: string; timestamp: string; annotations?: { enjoyment?: number | null; espressoNotes?: string | null } | null; workflow?: { profile?: { title: string }; context?: { grinderSetting?: string | null; coffeeName?: string | null; coffeeRoaster?: string | null } } }
type Page_ = { items: Shot[]; total: number }

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'BREW' })).toBeEnabled()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByTestId('history')).toBeVisible()
  await expect(page.getByTestId('shot-row').first()).toBeVisible()
}

const detail = (page: Page) => page.getByTestId('shot-detail')
const newest = async (n = 20) => (await decaid<Page_>('GET', `/api/v1/shots?limit=${n}`))

// Shots that exist before the test are edited in some tests; put their annotations back afterwards.
async function keepShot<T>(id: string, work: () => Promise<T>) {
  const before = await decaid<Shot>('GET', `/api/v1/shots/${id}`)
  try {
    return await work()
  } finally {
    await decaid('PUT', `/api/v1/shots/${id}`, { annotations: { enjoyment: before.annotations?.enjoyment ?? null, espressoNotes: before.annotations?.espressoNotes ?? null }, workflow: { context: { grinderSetting: before.workflow?.context?.grinderSetting ?? null, coffeeName: before.workflow?.context?.coffeeName ?? null, coffeeRoaster: before.workflow?.context?.coffeeRoaster ?? null, beanBatchId: (before.workflow?.context as { beanBatchId?: string } | undefined)?.beanBatchId ?? null } } })
  }
}

test.describe('History', () => {
  test.beforeAll(async () => {
    if ((await newest(1)).total < 25) throw new Error('History tests need at least 25 shots in the simulator')
  })

  test('HIST-01 lists shots newest first, grouped by day', async ({ page }) => {
    const { items, total } = await newest(5)
    await open(page)
    await expect(page.getByLabel('Search shots')).toHaveAttribute('placeholder', `SEARCH ${total} SHOTS · PROFILE, BEAN, NOTE`)
    const rows = page.getByTestId('shot-row')
    for (let i = 0; i < 5; i++) await expect(rows.nth(i)).toContainText(items[i].workflow?.profile?.title ?? 'Untitled')
    await expect(page.getByTestId('shot-list').getByRole('group').first()).toHaveAccessibleName(/^(TODAY|YESTERDAY|[A-Z]{3} \d{1,2} [A-Z]{3})/)
    await expect(rows.first()).toHaveAttribute('aria-current', 'true')
  })

  test('HIST-01 search goes to Decaid; clearing brings everything back', async ({ page }) => {
    const { total } = await decaid<Page_>('GET', '/api/v1/shots?limit=1&search=Best%20practice')
    await open(page)
    await page.getByLabel('Search shots').fill('Best practice')
    await expect.poll(async () => page.getByTestId('shot-row').count()).toBe(Math.min(total, 20))
    for (const t of await page.getByTestId('shot-row').locator('.lib-row-name').allTextContents()) expect(t).toContain('Best practice')
    await page.getByLabel('Search shots').fill('zzzz no such shot')
    await expect(page.getByTestId('history-empty')).toHaveText('No shots match “zzzz no such shot”.')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(page.getByTestId('shot-row')).toHaveCount(20)
  })

  test('HIST-02 choosing a shot redraws the chart from its data', async ({ page }) => {
    const { items } = await newest(3)
    const full = await decaid<{ measurements: unknown[] }>('GET', `/api/v1/shots/${items[1].id}`)
    await open(page)
    await page.getByTestId('shot-row').nth(1).click()
    await expect(page.getByTestId('shot-row').nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(detail(page)).toHaveAccessibleName(items[1].workflow?.profile?.title ?? 'Untitled')
    await expect(page.getByTestId('shot-when')).toHaveText(/^(TODAY|YESTERDAY|[A-Z]{3} \d{1,2} [A-Z]{3}( \d{4})?) · \d{1,2}:\d{2} · [A-Z ]+$/)
    await expect(page.getByTestId('shot-when')).not.toContainText(/apiStop|appStop|targetWeight/)
    if (full.measurements.length > 3) {
      await expect.poll(async () => detail(page).locator('[data-series="pressure"] circle').count()).toBeGreaterThan(0)
      await expect(page.getByTestId('shot-stats')).not.toContainText('TIME S--')
    }
  })

  test('HIST-03 rating: set, change, clear by tapping again', async ({ page }) => {
    const { items } = await newest(1)
    await keepShot(items[0].id, async () => {
      await decaid('PUT', `/api/v1/shots/${items[0].id}`, { annotations: { enjoyment: null } })
      await open(page)
      await detail(page).getByRole('button', { name: 'Rate 3 of 5' }).click()
      await expect.poll(async () => (await decaid<Shot>('GET', `/api/v1/shots/${items[0].id}`)).annotations?.enjoyment).toBe(6)
      await expect(page.getByTestId('shot-row').first().getByRole('img', { name: 'Rated 3 of 5' })).toBeVisible()
      await detail(page).getByRole('button', { name: 'Rate 5 of 5' }).click()
      await expect.poll(async () => (await decaid<Shot>('GET', `/api/v1/shots/${items[0].id}`)).annotations?.enjoyment).toBe(10)
      await detail(page).getByRole('button', { name: 'Rate 5 of 5' }).click()
      await expect.poll(async () => (await decaid<Shot>('GET', `/api/v1/shots/${items[0].id}`)).annotations?.enjoyment ?? null).toBeNull()
      await expect(page.getByTestId('shot-row').first().getByRole('img', { name: 'Not rated' })).toBeVisible()
    })
  })

  test('HIST-03 DONE-09 note, grind and coffee are saved to the shot and shown', async ({ page }) => {
    const { items } = await newest(1)
    const bean = await decaid<{ id: string }>('POST', '/api/v1/beans', { roaster: 'The Big Roasters', name: 'Brasilia' })
    const bag = await decaid<{ id: string }>('POST', `/api/v1/beans/${bean.id}/batches`, { weight: 250 })
    try {
    await keepShot(items[0].id, async () => {
      await open(page)
      await page.getByTestId('shot-note').click()
      const sheet = page.getByRole('dialog', { name: 'Shot notes' })
      await sheet.getByTestId('notes-input').fill('Bright, a touch sour — one step finer.')
      await sheet.getByTestId('grind-input').fill('2.5')
      await sheet.getByTestId('coffee-pick').click()
      const picker = page.getByRole('dialog', { name: 'Coffee and grinder for this shot' })
      await picker.getByRole('radio', { name: /Brasilia/ }).click()
      await picker.getByRole('button', { name: 'DONE' }).click()
      await expect(sheet.getByTestId('coffee-pick')).toContainText('The Big Roasters, Brasilia')
      await sheet.getByRole('button', { name: 'SAVE' }).click()
      await expect(sheet).toBeHidden()
      await expect(page.getByTestId('shot-note')).toContainText('Bright, a touch sour — one step finer.')
      await expect(page.getByTestId('shot-settings')).toContainText('2.5')
      await expect(page.getByTestId('shot-settings')).toContainText('The Big Roasters, Brasilia')
      const saved = await decaid<Shot>('GET', `/api/v1/shots/${items[0].id}`)
      expect(saved.annotations?.espressoNotes).toBe('Bright, a touch sour — one step finer.')
      expect(saved.workflow?.context?.grinderSetting).toBe('2.5')
      expect(saved.workflow?.context).toMatchObject({ coffeeRoaster: 'The Big Roasters', coffeeName: 'Brasilia', beanBatchId: bag.id })
      await expect(detail(page)).toContainText('The Big Roasters, Brasilia')
    })
    } finally {
      await decaid('DELETE', `/api/v1/bean-batches/${bag.id}`).catch(() => undefined)
      await decaid('DELETE', `/api/v1/beans/${bean.id}`).catch(() => undefined)
    }
  })

  test('HIST-05 upload shows only with the Visualizer plugin running; success and failure messages', async ({ page }) => {
    // The simulator may or may not run Visualizer; the test decides.
    let running = false
    await page.route('**/api/v1/plugins', async (r) => {
      const list = await (await r.fetch()).json()
      await r.fulfill({ json: list.map((p: { id: string }) => (p.id === 'visualizer.reaplugin' ? { ...p, autoLoad: running, loaded: running } : p)) })
    })
    await open(page)
    await expect(detail(page).getByRole('button', { name: 'UPLOAD' })).toHaveCount(0)
    running = true
    let fail = false
    let sent: unknown = null
    await page.route('**/api/v1/plugins/visualizer.reaplugin/upload', (r) => {
      sent = r.request().postDataJSON()
      return fail ? r.fulfill({ status: 500, json: { error: 'Error: Visualizer returned 401 Unauthorized' } }) : r.fulfill({ status: 202, json: { visualizer_id: 'abc' } })
    })
    await page.reload()
    await page.getByRole('button', { name: 'History' }).click()
    const { items } = await newest(1)
    await detail(page).getByRole('button', { name: 'UPLOAD' }).click()
    await expect(page.getByText('Uploaded to Visualizer')).toBeVisible()
    expect(sent).toEqual({ shotId: items[0].id })
    fail = true
    await detail(page).getByRole('button', { name: 'UPLOAD' }).click()
    await expect(page.getByText("Couldn't upload to Visualizer. Check the plugin's sign-in in Decaid.")).toBeVisible()
    await expect(page.getByText(/401|Unauthorized/)).toHaveCount(0)
  })

  test('HIST-06 empty history', async ({ page }) => {
    await page.route('**/api/v1/shots?limit=*', (r) => r.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByTestId('history-empty')).toHaveText('No shots yet.')
    await expect(page.getByLabel('Search shots')).toHaveAttribute('placeholder', 'SEARCH SHOTS · PROFILE, BEAN, NOTE')
    await expect(page.getByTestId('shot-detail')).toHaveCount(0)
  })

  test('HIST-06 a failed load offers to try again', async ({ page }) => {
    let failing = true
    await page.route('**/api/v1/shots?limit=*', (r) => (failing ? r.fulfill({ status: 500, body: 'boom' }) : r.fallback()))
    await page.goto('/')
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByRole('alert')).toContainText("Couldn't load shots.")
    failing = false
    await page.getByRole('button', { name: 'TRY AGAIN' }).click()
    await expect(page.getByTestId('shot-row').first()).toBeVisible()
  })

  test('HIST-07 more shots load as the list scrolls', async ({ page }) => {
    const { total } = await newest(1)
    await open(page)
    await expect(page.getByTestId('shot-row')).toHaveCount(20)
    await page.getByTestId('history-more').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('shot-row')).toHaveCount(Math.min(40, total))
    await page.getByTestId('shot-row').last().scrollIntoViewIfNeeded()
    await expect.poll(async () => page.getByTestId('shot-row').count(), { timeout: 10_000 }).toBe(Math.min(60, total))
  })

  test('HIST-02 Brew again loads the shot’s profile and goes Home', async ({ page }) => {
    const { items } = await newest(20)
    const other = items.find((s) => s.workflow?.profile?.title && s.workflow.profile.title !== items[0].workflow?.profile?.title)
    test.skip(!other, 'needs shots of two profiles')
    await open(page)
    await page.getByTestId('shot-row').nth(items.indexOf(other!)).click()
    await detail(page).getByRole('button', { name: 'BREW AGAIN' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
    await expect.poll(currentTitle).toBe(other!.workflow!.profile!.title)
  })

  test('HIST-01 back returns Home', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
  })
})
