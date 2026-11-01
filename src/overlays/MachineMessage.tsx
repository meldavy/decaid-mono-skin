import { useEffect, useState } from 'react'
import { useLive } from '../state/live'
import { requestState } from '../state/machine'
import { DotIcon } from '../ui/DotIcon'
import { errorToast } from '../ui/toasts'
import './refill.css'

// Machine messages (brown card on the display), for states that aren't brewing: maintenance running, a firmware
// update, or an error. Shown over any screen while the machine is in that state; gone when it leaves it.
type Kind = 'cleaning' | 'descaling' | 'airPurge' | 'fwUpgrade' | 'error'

const COPY: Record<Kind, { title: string[]; body: string; stop: boolean; dismiss: boolean }> = {
  cleaning: { title: ['CLEANING'], body: 'Leave the blind basket in until it finishes.', stop: true, dismiss: false },
  descaling: { title: ['DESCALING'], body: 'About 20 minutes. Keep the drip tray in place.', stop: true, dismiss: false },
  airPurge: { title: ['EMPTYING'], body: 'Finishes by itself.', stop: true, dismiss: false },
  fwUpgrade: { title: ['UPDATING'], body: "The machine's firmware is updating. Don't switch it off; it restarts by itself when done.", stop: false, dismiss: false },
  error: { title: ['MACHINE', 'ERROR'], body: 'Switch the machine off and on at the back. If it keeps happening, contact Decent support.', stop: false, dismiss: true },
}

export function MachineMessage() {
  const state = useLive((l) => l.machine?.state.state) as Kind | string | undefined
  const kind = state && state in COPY ? (state as Kind) : null
  const [dismissed, setDismissed] = useState<Kind | null>(null)
  const [stopping, setStopping] = useState(false)
  useEffect(() => { if (!kind) { setDismissed(null); setStopping(false) } }, [kind])
  if (!kind || dismissed === kind) return null
  const copy = COPY[kind]
  const stop = async () => {
    setStopping(true)
    try { await requestState('idle') } catch (error) { setStopping(false); errorToast(error, "Couldn't stop the machine.") }
  }
  return (
    <div className="refill-layer">
      <div className="scrim light" />
      <section className="refill display" role="alertdialog" aria-label={copy.title.join(' ').toLowerCase()} data-testid="machine-message" data-kind={kind}>
        <div className="refill-text">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span className="label">FROM THE MACHINE</span>
            <span className="dots refill-title">{copy.title.map((line, i) => <span key={i}>{line}<br /></span>)}</span>
          </div>
          <span className="refill-body">{copy.body}</span>
          <div className="refill-foot">
            <span className="label">{stopping ? 'STOPPING…' : ''}</span>
            {copy.stop && <button type="button" className="refill-ok" disabled={stopping} onClick={stop}><DotIcon glyph="stop" color="var(--display)" primary />STOP</button>}
            {copy.dismiss && <button type="button" className="refill-ok" onClick={() => setDismissed(kind)}><DotIcon glyph="check" color="var(--display)" />GOT IT</button>}
          </div>
        </div>
        <div className="refill-gauge" style={{ justifyContent: 'center' }}>
          <DotIcon glyph={kind === 'error' ? 'close' : kind === 'fwUpgrade' ? 'settings' : 'flush'} color="var(--display-cream)" primary />
        </div>
      </section>
    </div>
  )
}
