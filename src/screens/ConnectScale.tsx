import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useLive } from '../state/live'
import { DotIcon } from '../ui/DotIcon'
import { errorToast, toast } from '../ui/toasts'

// Find and connect a scale. Scanning shows what Decaid finds; tap one to connect.
export function ConnectScale({ onClose }: { onClose: () => void }) {
  const devices = useLive((l) => l.devices)
  const scanning = useLive((l) => l.scanning)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const scales = devices.filter((d) => d.type === 'scale')
  const connected = scales.find((d) => d.state === 'connected')

  const scan = () => api.get('/api/v1/devices/scan?connect=false&quick=true').catch(errorToast)
  useEffect(() => { void scan() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  const connect = async (id: string, name: string) => {
    setConnecting(id)
    setFailed(null)
    try {
      await api.put('/api/v1/devices/connect', { deviceId: id })
      toast(`${name} connected`)
      onClose()
    } catch {
      setFailed(name)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="confirm-layer">
      <div className="scrim" onClick={onClose} />
      <section className="confirm connect-scale" role="dialog" aria-modal="true" aria-label="Connect a scale">
        <span className="label">{scanning ? 'LOOKING FOR SCALES…' : 'SCALES NEARBY'}</span>
        <span className="confirm-title">Connect a scale</span>
        <div className="cs-list" data-testid="scale-list">
          {scales.map((d) => (
            <button key={d.id} type="button" className="set-row set-row-btn" disabled={!!connecting || d.state === 'connected'} onClick={() => connect(d.id, d.name)} aria-label={d.name}>
              <span className="set-row-text one-line">{d.name}</span>
              <span className="label">{d.state === 'connected' ? 'CONNECTED' : connecting === d.id ? 'CONNECTING…' : 'CONNECT'}</span>
            </button>
          ))}
          {!scales.length && <span className="confirm-body">{scanning ? 'Looking for scales…' : 'No scales found. Is it awake?'}</span>}
        </div>
        {failed && <span className="confirm-body" role="alert">Couldn't connect to {failed}. Make sure it's on and close by, then try again.</span>}
        <div className="confirm-actions">
          <button type="button" className="quiet-button" onClick={onClose}>{connected ? 'DONE' : 'CANCEL'}</button>
          <button type="button" className="save" disabled={scanning} onClick={() => void scan()}><DotIcon glyph="search" color="#fff" />LOOK AGAIN</button>
        </div>
      </section>
    </div>
  )
}
