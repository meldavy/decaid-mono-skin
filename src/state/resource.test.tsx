import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useNow } from './resource'

describe('useNow', () => {
  it('keeps ticking while the component re-renders faster than the interval', () => {
    vi.useFakeTimers()
    let rerender: () => void = () => undefined
    const seen: number[] = []
    function Clock() {
      const [, set] = useState(0)
      rerender = () => set((n) => n + 1)
      seen.push(useNow(250))
      return null
    }
    render(<Clock />)
    const first = seen[0]
    for (let i = 0; i < 20; i++) act(() => { rerender(); vi.advanceTimersByTime(100) })
    expect(seen[seen.length - 1] - first).toBeGreaterThanOrEqual(1_750)
    vi.useRealTimers()
  })
})
