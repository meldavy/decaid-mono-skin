import { describe, expect, it } from 'vitest'
import { parseSlots, serializeSlots } from './favourites'
import { DEFAULT_PREFS, withDefaults } from './prefs'

describe('prefs', () => {
  it('fills missing keys from defaults and rejects bad values', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_PREFS)
    expect(withDefaults({ accent: 'rust', units: 'f' })).toMatchObject({ accent: 'rust', units: 'f', clock: '24' })
    expect(withDefaults({ accent: 'neon' as never, screenOffAfter: '9' as never }).accent).toBe('crema')
    expect(withDefaults({ screenOffAfter: '9' as never }).screenOffAfter).toBe(60)
  })
})

describe('favourite slots', () => {
  it('read Streamline\'s object form, tolerate junk, and round-trip', () => {
    expect(parseSlots(null)).toEqual([null, null, null, null, null])
    expect(parseSlots(['a'])).toEqual([null, null, null, null, null])
    const slots = parseSlots({ 0: 'profile:a', 2: 'profile:c', 3: '', 4: 7 })
    expect(slots).toEqual(['profile:a', null, 'profile:c', null, null])
    expect(serializeSlots(slots)).toEqual({ 0: 'profile:a', 1: null, 2: 'profile:c', 3: null, 4: null })
  })
})
