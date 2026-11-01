import { plainError } from './toasts'

describe('plainError', () => {
  it('keeps a plain sentence', () => {
    expect(plainError(new Error('Scale not connected.'))).toBe('Scale not connected.')
  })
  it.each([
    'Failed to enable plugin: PlatformException(KeyringLocked, KeyringLocked, null, null)',
    'POST /api/v1/settings failed (500)',
    'TypeError: x is undefined',
    '{"error":"bad"}',
    'invalid_argument',
    'Error: Visualizer returned 401 Unauthorized',
    'Connection timeout',
    '',
  ])('hides technical text: %s', (text) => {
    expect(plainError(new Error(text))).toBe("Decaid couldn't do that. Try again.")
  })
  it('uses the given fallback', () => {
    expect(plainError(new Error('NullPointerException'), 'Couldn’t save.')).toBe('Couldn’t save.')
  })
})
