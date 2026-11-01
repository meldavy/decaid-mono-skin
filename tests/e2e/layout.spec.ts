import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Every screen, reached the way a person would.
const SCREENS: [string, (p: Page) => Promise<void>][] = [
  ['home', async () => {}],
  ['library', (p) => p.getByRole('button', { name: 'All profiles' }).click()],
  ['favourites', async (p) => { await p.getByRole('button', { name: 'All profiles' }).click(); await p.getByRole('button', { name: 'MANAGE FAVOURITES' }).click() }],
  ['editor', async (p) => { await p.getByRole('button', { name: 'All profiles' }).click(); await p.locator('.lib-row[aria-current="true"]').click(); await p.getByTestId('lib-detail').getByRole('button', { name: /EDIT A COPY|EDIT/ }).first().click() }],
  ['history', async (p) => { await p.getByRole('button', { name: 'History' }).click(); await p.getByTestId('shot-row').first().waitFor() }],
  ...['Brewing', 'Devices & water', 'Machine', 'Maintenance', 'Sleep & display', 'Look & sound', 'Keyboard', 'System'].map((s) => [`settings ${s}`, async (p: Page) => { await p.getByRole('button', { name: 'Settings' }).click(); await p.getByRole('button', { name: s, exact: true }).click() }] as [string, (p: Page) => Promise<void>]),
]

const SIZES = [{ width: 1194, height: 834 }, { width: 1000, height: 600 }] // the design size and the real tablet

for (const size of SIZES) {
  test.describe(`at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size })
    for (const [name, go] of SCREENS) {
      test(`GLB-23 GLB-25 ${name}: no page scroll, nothing off-screen, every control named and at least 44 px`, async ({ page }) => {
        await page.goto('/')
        await expect(page.getByRole('button', { name: 'BREW' })).toBeVisible()
        await go(page)
        await page.waitForTimeout(600)
        const report = await page.evaluate(() => {
          const out: string[] = []
          const doc = document.documentElement
          if (doc.scrollHeight > innerHeight + 1) out.push(`page scrolls vertically (${doc.scrollHeight} > ${innerHeight})`)
          if (doc.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${doc.scrollWidth} > ${innerWidth})`)
          // Inside a scroller or a clipped carousel, being partly out of view is by design.
          const clipped = (el: Element) => {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const s = getComputedStyle(a)
              if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true
            }
            return false
          }
          const controls = document.querySelectorAll('button, [role="button"], [role="switch"], [role="radio"], [role="slider"], input:not([type="file"]):not([hidden]), textarea, label.chip')
          for (const el of controls) {
            const r = el.getBoundingClientRect()
            const s = getComputedStyle(el)
            if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') continue
            if (el.closest('[aria-hidden="true"]')) continue
            const named = (el.getAttribute('aria-label') ?? '').trim() || (el.textContent ?? '').trim() || (el as HTMLInputElement).placeholder || el.getAttribute('aria-labelledby') || el.closest('label')?.textContent?.trim()
            const desc = `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} "${(el.textContent ?? '').trim().slice(0, 24)}"`
            if (!named) out.push(`no name: ${desc}`)
            // A control sitting inside a larger hit target (a row, a label) counts as that target.
            const target = el.closest('label, .set-row, .set-row-btn, .lib-row') ?? el
            const t = target.getBoundingClientRect()
            if (Math.min(t.width, t.height) < 44 - 0.5) out.push(`small (${Math.round(t.width)}×${Math.round(t.height)}): ${desc}`)
            if (!clipped(el) && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1)) out.push(`off-screen: ${desc}`)
          }
          return out
        })
        expect(report).toEqual([])
      })
    }
  })
}
