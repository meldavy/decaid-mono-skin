import type { Page } from '@playwright/test'
import { decaid } from './decaid'
import { expect, loadByApi, test } from './fixtures'

// GLB-27: everything drawn with dots on a brown display starts on the display's 9 px grid, at any screen size.
const SIZES = [[1024, 600], [1194, 834], [1333, 777], [1920, 1200]] as const

async function offGrid(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = []
    for (const svg of document.querySelectorAll<SVGElement>('.display svg.grid-patch')) {
      const display = svg.closest('.display')!.getBoundingClientRect()
      const r = svg.getBoundingClientRect()
      const dx = (r.left - display.left) % 9
      const dy = (r.top - display.top) % 9
      const near = (d: number) => d < 0.5 || d > 8.5
      if (!near(dx) || !near(dy)) bad.push(`${svg.getAttribute('aria-label') ?? svg.getAttribute('class')} at +${dx.toFixed(1)}, +${dy.toFixed(1)}`)
    }
    return bad
  })
}

for (const [w, h] of SIZES) {
  test(`GLB-27 Home display drawings sit on the grid at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(page.getByLabel('Selected profile plan')).toBeVisible()
    expect(await offGrid(page)).toEqual([])
  })

  test(`GLB-27 live shot display drawings sit on the grid at ${w}×${h}`, async ({ page, profiles }) => {
    await loadByApi(profiles.find((p) => p.profile.title === 'Default') ?? profiles[0])
    await decaid('PUT', '/api/v1/workflow', { context: { targetYield: 200 } })
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await decaid('PUT', '/api/v1/machine/state/espresso')
    await expect(page.getByTestId('live-shot').getByTestId('dot-chart')).toBeVisible()
    await page.waitForTimeout(300)
    expect(await offGrid(page)).toEqual([])
    expect(await page.locator('.display svg.grid-patch').count()).toBeGreaterThanOrEqual(2)
  })
}
