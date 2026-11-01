import { describe, expect, it } from 'vitest'
import { parseProfileFile } from './profiles'

describe('profiles', () => {
  it('LIB-12 reads a Decent v2 profile file, with or without a record wrapper; rejects anything else', () => {
    const p = { title: 'X', steps: [{ name: 'a', pump: 'pressure', pressure: 9, flow: null, seconds: 10, transition: 'fast' }] }
    expect(parseProfileFile(JSON.stringify(p)).title).toBe('X')
    expect(parseProfileFile(JSON.stringify({ id: 'profile:1', profile: p })).title).toBe('X')
    expect(() => parseProfileFile('not json')).toThrow("isn't a profile")
    expect(() => parseProfileFile(JSON.stringify({ title: 'no steps', steps: [] }))).toThrow("isn't a profile")
  })
})
