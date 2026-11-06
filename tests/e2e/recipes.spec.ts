import { expect, test, type ProfileRecord } from './fixtures'
import { decaid } from './decaid'

// Recipes come from DYE2 (needs DYE2 running in the simulator). The tests put a recipe straight into DYE2's
// store and take it out again: in real use only DYE2 writes there.

type Workflow = { profile: { title: string; steps: unknown[] }; context?: Record<string, unknown> }
const DYE2_STORE = '/api/v1/store/dye2.reaplugin/recipes'

async function withRecipe(work: (recipe: { id: string; name: string }, profile: ProfileRecord) => Promise<void>) {
  const before = await decaid<unknown[]>('GET', DYE2_STORE).catch(() => null)
  const profiles = await decaid<ProfileRecord[]>('GET', '/api/v1/profiles')
  const profile = profiles.find((p) => p.visibility === 'visible' && p.profile.title === 'Adaptive v3') ?? profiles.find((p) => p.visibility === 'visible')!
  const full = await decaid<{ profile: Workflow['profile'] }>('GET', `/api/v1/profiles/${encodeURIComponent(profile.id)}`)
  const recipe = {
    id: 'recipe-e2e', name: 'E2E Recipe', profileTitle: full.profile.title, profileSnapshot: full.profile,
    dashboardVariables: { dose: 20, drink: 44, grind: '9.9' },
    workflow: { profile: full.profile, context: { targetDoseWeight: 20, targetYield: 44, grinderSetting: '9.9', coffeeName: null, coffeeRoaster: null, beanBatchId: null } },
  }
  await decaid('POST', DYE2_STORE, [...(Array.isArray(before) ? before : []), recipe])
  try {
    await work(recipe, profile)
  } finally {
    if (Array.isArray(before)) await decaid('POST', DYE2_STORE, before)
    else await decaid('DELETE', DYE2_STORE).catch(() => undefined)
  }
}

test.describe('Recipes', () => {
  test.beforeAll(async () => {
    const plugins = await decaid<{ id: string; loaded?: boolean }[]>('GET', '/api/v1/plugins')
    test.skip(!plugins.some((p) => p.id === 'dye2.reaplugin' && p.loaded), 'DYE2 is not running in the simulator')
  })

  test('RECIPE-01 a recipe card sets its values; a profile card brings the profile settings back, after a reload too', async ({ page }) => {
    await withRecipe(async (recipe) => {
      const slots = await decaid<Record<string, string | null>>('GET', '/api/v1/store/streamline-app/favorite-profiles')
      const plainId = slots['0']!
      // Slot 2 holds the recipe (its profile in the shared slot, Mono's note on top).
      const profiles = await decaid<ProfileRecord[]>('GET', '/api/v1/profiles')
      const recipeProfileId = profiles.find((p) => p.profile.title === (recipe as unknown as { profileTitle: string }).profileTitle && p.visibility !== 'deleted')!.id
      await decaid('POST', '/api/v1/store/streamline-app/favorite-profiles', { ...slots, 1: recipeProfileId })
      await decaid('POST', '/api/v1/store/mono/recipe-slots', { 1: { recipeId: recipe.id, profileId: recipeProfileId } })
      // Profile mode: the person's own dose and grind.
      const plain = profiles.find((p) => p.id === plainId)!
      const plainFull = await decaid<{ profile: unknown }>('GET', `/api/v1/profiles/${encodeURIComponent(plainId)}`)
      await decaid('PUT', '/api/v1/workflow', { profile: plainFull.profile, context: { targetDoseWeight: 16.5, grinderSetting: '2.2' } })

      await page.goto('/')
      await page.getByRole('button', { name: /Slot 2, E2E Recipe/ }).click()
      await expect(page.getByTestId('value-dose')).toContainText('20.0', { timeout: 8_000 })
      await expect(page.getByTestId('value-grind')).toContainText('9.9')

      await page.reload() // Mono restarting in recipe mode keeps the profile settings aside
      const side = page.getByRole('button', { name: new RegExp(`^Slot 1, `) })
      const box = (await side.boundingBox())!
      await side.click({ position: { x: box.width - 16, y: box.height / 2 } }) // only its right edge shows, left of the main card
      await expect(page.getByTestId('value-dose')).toContainText('16.5', { timeout: 8_000 })
      await expect(page.getByTestId('value-grind')).toContainText('2.2')
      const wf = await decaid<Workflow>('GET', '/api/v1/workflow')
      expect(wf.profile.title).toBe(plain.profile.title)
      expect(await decaid('GET', '/api/v1/store/mono/profile-settings').catch(() => null)).toBeNull()
    })
  })
})
