import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { expect, loadByApi, setFavourites, test, type ProfileRecord } from './fixtures'

const store = () => decaid<Record<string, string | null> | null>('GET', '/api/v1/store/streamline-app/favorite-profiles')
const slot = (page: Page, i: number) => page.locator(`[data-slot="${i}"]`)
const card = (page: Page, title: string) => page.getByTestId('favs-grid').getByRole('button', { name: title, exact: true })

async function open(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'All profiles' }).click()
  await page.getByRole('button', { name: 'MANAGE FAVOURITES' }).click()
  await expect(page.getByTestId('favourites')).toBeVisible()
}

// Hold, then drag onto a target (or to an arbitrary point when `to` is a position).
async function dragTo(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']> | { x: number; y: number }) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const b = 'x' in to ? to : await (async () => { const bb = (await to.boundingBox())!; return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } })()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(450)
  await page.mouse.move(b.x, b.y, { steps: 14 })
  await page.mouse.up()
}

let p: ProfileRecord[]

test.describe('Favourites', () => {
  test.beforeEach(async ({ profiles }) => {
    p = profiles
    await setFavourites([profiles[0].id, profiles[1].id, profiles[2].id, null, profiles[4].id])
    await loadByApi(profiles[0])
  })

  test('FAV-01 slots show the shared favourites; the grid shows every other visible profile', async ({ page }) => {
    await open(page)
    await expect(slot(page, 0)).toContainText(p[0].profile.title)
    await expect(slot(page, 3)).toContainText('Empty')
    await expect(slot(page, 0)).toContainText('● ACTIVE')
    await expect(page.getByTestId('favs-grid').locator('.fav-card')).toHaveCount(p.length - 4)
    await expect(card(page, p[0].profile.title)).toHaveCount(0)
  })

  test('FAV-02 dragging a profile onto an empty slot adds it', async ({ page }) => {
    await open(page)
    await dragTo(page, card(page, p[7].profile.title), slot(page, 3))
    await expect(slot(page, 3)).toContainText(p[7].profile.title)
    await expect(card(page, p[7].profile.title)).toHaveCount(0)
  })

  test('FAV-03 dropping on a filled slot replaces it (the old one returns to the library); slot onto slot swaps', async ({ page }) => {
    await open(page)
    await dragTo(page, card(page, p[8].profile.title), slot(page, 1))
    await expect(slot(page, 1)).toContainText(p[8].profile.title)
    await expect(card(page, p[1].profile.title)).toBeVisible()
    await dragTo(page, slot(page, 0), slot(page, 2))
    await expect(slot(page, 0)).toContainText(p[2].profile.title)
    await expect(slot(page, 2)).toContainText(p[0].profile.title)
  })

  test('FAV-04 a drag dropped outside the slots changes nothing; a quick move is a scroll, not a drag', async ({ page }) => {
    await open(page)
    await dragTo(page, card(page, p[7].profile.title), { x: 600, y: 760 })
    await expect(slot(page, 3)).toContainText('Empty')
    await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
    const a = (await card(page, p[7].profile.title).boundingBox())!
    await page.mouse.move(a.x + 50, a.y + 50); await page.mouse.down(); await page.mouse.move(a.x + 50, a.y - 100, { steps: 3 }); await page.waitForTimeout(450); await page.mouse.up()
    await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
    await expect(page.getByTestId('fav-detail')).toHaveCount(0)
  })

  test('FAV-05 removing a profile from its slot', async ({ page }) => {
    await open(page)
    await slot(page, 1).click()
    await page.getByRole('button', { name: 'REMOVE FROM SLOT' }).click()
    await expect(slot(page, 1)).toContainText('Empty')
    await expect(card(page, p[1].profile.title)).toBeVisible()
  })

  test('FAV-06 tapping a profile opens its details (no slot picker: slots change by dragging); Close / Esc close it', async ({ page }) => {
    await open(page)
    await card(page, p[9].profile.title).click()
    const d = page.getByTestId('fav-detail')
    await expect(d).toContainText(p[9].profile.title)
    await expect(d).not.toContainText('FAVOURITE 0') // not one of the five yet
    await expect(d.getByRole('radiogroup')).toHaveCount(0)
    await expect(d.getByRole('button', { name: /PUT IN SLOT|MOVE TO SLOT/ })).toHaveCount(0)
    await expect(d.getByRole('button', { name: /EDIT/ })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(d).toHaveCount(0)
    await card(page, p[10].profile.title).click()
    await page.keyboard.press('Escape')
    await expect(d).toHaveCount(0)
  })

  test('FAV-07 Done saves to Streamline\'s shared store in slot order and marks them as set by a person', async ({ page }) => {
    await open(page)
    await dragTo(page, card(page, p[7].profile.title), slot(page, 3))
    await page.getByRole('button', { name: 'DONE' }).click()
    await expect.poll(store).toEqual({ 0: p[0].id, 1: p[1].id, 2: p[2].id, 3: p[7].id, 4: p[4].id })
    expect(await decaid('GET', '/api/v1/store/streamline-app/favorite-profiles-initialized')).toBe(true)
    await expect(page.getByTestId('library')).toBeVisible()
  })

  test('FAV-08 MODAL-04 leaving with unsaved changes asks: Keep editing / Discard / Save', async ({ page }) => {
    await open(page)
    await dragTo(page, card(page, p[7].profile.title), slot(page, 3))
    await page.getByRole('button', { name: 'Back to profiles' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(dialog).toContainText('Slot 04')
    await expect(dialog).toContainText(p[7].profile.title)
    await page.getByRole('button', { name: 'KEEP EDITING' }).click()
    await expect(page.getByTestId('favourites')).toBeVisible()
    await page.getByRole('button', { name: 'Back to profiles' }).click()
    await page.getByRole('button', { name: 'DISCARD' }).click()
    await expect(page.getByTestId('library')).toBeVisible()
    expect((await store())!['3']).toBeNull()
    await page.getByRole('button', { name: 'MANAGE FAVOURITES' }).click()
    await dragTo(page, card(page, p[7].profile.title), slot(page, 3))
    await page.getByRole('button', { name: 'Back to profiles' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'SAVE' }).click()
    await expect.poll(async () => (await store())!['3']).toBe(p[7].id)
  })

  test('FAV-09 missing favourites show as empty slots and nothing is written until saved', async ({ page }) => {
    await decaid('DELETE', '/api/v1/store/streamline-app/favorite-profiles')
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes('/store/') && r.method() !== 'GET') writes.push(r.url()) })
    await open(page)
    for (let i = 0; i < 5; i++) await expect(slot(page, i)).toContainText('Empty')
    await page.getByRole('button', { name: 'Back to profiles' }).click()
    expect(writes).toEqual([])
    expect(await store()).toBeNull()
  })

  test('GLB-26 long names stay inside the slots and cards', async ({ page }) => {
    const fake = { ...p[3], profile: { ...p[3].profile, title: 'Supercalifragilisticexpialidocious — a very long profile name indeed, longer than any real one' } }
    await page.route('**/api/v1/profiles?includeHidden=true', async (route) => { const res = await route.fetch(); const list = await res.json(); await route.fulfill({ response: res, json: list.map((r: ProfileRecord) => (r.id === fake.id ? fake : r)) }) })
    await setFavourites([fake.id, p[1].id, p[2].id, null, p[4].id])
    await open(page)
    const box = (await slot(page, 0).boundingBox())!
    expect(box.height).toBe(168)
    const name = slot(page, 0).locator('.fav-slot-name')
    expect(await name.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))).toBeLessThanOrEqual(3)
  })
})
