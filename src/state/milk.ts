import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { openSocket, type SocketHandle } from '../api/socket'

// Milk temperature while steaming, from whichever sensor Decaid's own steam stop follows: the Bengle milk probe if
// there is one, else the first sensor with a numeric `temperature` channel (e.g. the milk camera plugin).

// From the start of the steam, how long the modal waits for a first reading before it settles on the timer.
export const MILK_GRACE_MS = 5_000
// A reading this old, or a run of zeros this long, is lost: the modal goes back to the timer.
export const MILK_STALE_MS = 2_000

export interface SensorInfo {
  id: string
  info?: { name?: string; vendor?: string; data?: { key: string; type: string }[] }
}

export function pickMilkSensor(sensors: SensorInfo[]): string | null {
  const withTemp = sensors.filter((s) => s.info?.data?.some((c) => c.key === 'temperature' && c.type === 'number'))
  const probe = withTemp.find((s) => s.info?.name === 'Bengle Milk Probe' && s.info?.vendor === 'DecentEspresso')
  return (probe ?? withTemp[0])?.id ?? null
}

export interface MilkTrack {
  celsius: number | null // last non-zero reading
  at: number // when it arrived (ms), 0 = never
  first: number | null // first non-zero reading of this steam: where the progress bar starts
}

export const NO_MILK: MilkTrack = { celsius: null, at: 0, first: null }

// Decaid sensors report 0 for "no reading"; only a positive, finite value counts.
export function foldMilk(track: MilkTrack, celsius: unknown, now: number): MilkTrack {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius) || celsius <= 0) return track
  return { celsius, at: now, first: track.first ?? celsius }
}

export type SteamMode = 'temperature' | 'waiting' | 'time' | 'lost'

// temperature: a stop temperature is set and a reading is fresh → bar and caption follow the milk.
// waiting: stop temperature set, no reading yet, still inside the grace period → timer, saying so.
// lost: there was a reading but it went stale → timer, saying so. time: no stop temperature, or no reading by the
// end of the grace period. The timer runs underneath throughout, so falling back never restarts it.
export function steamMode(target: number | undefined, track: MilkTrack, startedAt: number, now: number): SteamMode {
  if (!target || target <= 0) return 'time'
  if (track.at > 0 && now - track.at <= MILK_STALE_MS) return 'temperature'
  if (track.at > 0) return 'lost'
  return now - startedAt < MILK_GRACE_MS ? 'waiting' : 'time'
}

// 0 at the first reading of this steam, 1 at the stop temperature.
export function milkProgress(track: MilkTrack, target: number) {
  if (track.celsius === null || track.first === null) return 0
  if (target <= track.first) return 1
  return Math.min(1, Math.max(0, (track.celsius - track.first) / (target - track.first)))
}

// Follows the milk sensor while `active`. Looks the sensor up again every few seconds until one turns up.
export function useMilkTemperature(active: boolean): MilkTrack {
  const [track, setTrack] = useState<MilkTrack>(NO_MILK)
  const ref = useRef(NO_MILK)
  useEffect(() => {
    if (!active) return
    ref.current = NO_MILK
    setTrack(NO_MILK)
    let socket: SocketHandle | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const find = async () => {
      try {
        const id = pickMilkSensor(await api.get<SensorInfo[]>('/api/v1/sensors'))
        if (stopped) return
        if (id) {
          socket = openSocket<Record<string, unknown>>(`/ws/v1/sensors/${encodeURIComponent(id)}/snapshot`, (msg) => {
            const data = (msg.data ?? msg) as Record<string, unknown>
            const next = foldMilk(ref.current, data.temperature, Date.now())
            if (next !== ref.current) { ref.current = next; setTrack(next) }
          })
          return
        }
      } catch {
        // Decaid unreachable: the link banner covers it.
      }
      if (!stopped) timer = setTimeout(find, 3_000)
    }
    void find()
    return () => { stopped = true; clearTimeout(timer); socket?.close() }
  }, [active])
  return track
}
