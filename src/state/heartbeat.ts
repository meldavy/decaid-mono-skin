import { useEffect, useRef } from 'react'
import { api } from '../api/client'

// Tells Decaid someone is using the machine, so "sleep when nobody's around" counts from the last touch.
// Sent on a touch or key press, at most every 30 s, and never while the machine sleeps (a tap on the sleep
// screen must not keep it awake or wake it).
export const HEARTBEAT_EVERY_MS = 30_000

export function useHeartbeat(machineState: string | undefined) {
  const last = useRef(0)
  const state = useRef(machineState)
  state.current = machineState
  useEffect(() => {
    const beat = () => {
      if (state.current === 'sleeping' || state.current === undefined) return
      const now = Date.now()
      if (now - last.current < HEARTBEAT_EVERY_MS) return
      last.current = now
      api.post('/api/v1/machine/heartbeat').catch(() => undefined)
    }
    window.addEventListener('pointerdown', beat, true)
    window.addEventListener('keydown', beat, true)
    return () => {
      window.removeEventListener('pointerdown', beat, true)
      window.removeEventListener('keydown', beat, true)
    }
  }, [])
}
