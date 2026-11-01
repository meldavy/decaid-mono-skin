import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast, Toasts } from './toasts'

describe('GLB-12 toasts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('appear, stack (three at most, newest last) and time out', () => {
    render(<Toasts />)
    act(() => { toast('one'); toast('two'); toast('three'); toast('four') })
    expect(screen.getAllByRole('status').map((t) => t.textContent)).toEqual(['two', 'three', 'four'])
    act(() => { vi.advanceTimersByTime(4_100) })
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })

  it('an error toast is an alert and stays longer', () => {
    render(<Toasts />)
    act(() => { toast('bad', 'error', undefined, 6_000) })
    act(() => { vi.advanceTimersByTime(4_100) })
    expect(screen.getByRole('alert').textContent).toBe('bad')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("an action toast's action runs and dismisses it", () => {
    const run = vi.fn()
    render(<Toasts />)
    act(() => { toast('Deleted', 'info', { label: 'UNDO', run }) })
    fireEvent.click(screen.getByRole('button', { name: 'UNDO' }))
    expect(run).toHaveBeenCalledOnce()
    expect(screen.queryByText('Deleted')).toBeNull()
  })
})
