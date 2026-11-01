import { useEffect, useRef, useState } from 'react'
import { useLive } from '../state/live'
import { needsRefill, tankPercent } from '../state/water'
import { DotIcon } from '../ui/DotIcon'
import './refill.css'

// A machine message on the display: shown while the machine says it needs water, over any screen.
// "Got it" hides it until the machine has been refilled and asks again; it closes by itself once refilled.

const COLS = 6
const ROWS = 13

export function RefillModal() {
  const water = useLive((l) => l.water)
  const machineState = useLive((l) => l.machine?.state.state)
  const low = needsRefill(machineState)
  const [dismissed, setDismissed] = useState(false)
  const wasLow = useRef(low)
  useEffect(() => {
    if (!low && wasLow.current) setDismissed(false) // refilled: the next low tank shows again
    wasLow.current = low
  }, [low])

  if (!low || dismissed) return null
  const pct = tankPercent(water?.currentLevel) ?? 0
  const needs = tankPercent(water?.refillLevel)
  const litRows = Math.round((pct / 100) * ROWS)

  return (
    <div className="refill-layer">
      <div className="scrim light" />
      <section className="refill display" role="alertdialog" aria-label="Refill the water tank" data-testid="refill">
        <div className="refill-text">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span className="label">FROM THE MACHINE</span>
            <span className="dots refill-title">REFILL<br />TANK</span>
          </div>
          <span className="refill-body">Fill the tank to carry on.</span>
          <div className="refill-foot">
            <span className="label">{needs ? `NEEDS ${needs}% TO BREW` : ''}</span>
            <button type="button" className="refill-ok" onClick={() => setDismissed(true)}><DotIcon glyph="check" color="var(--display)" />GOT IT</button>
          </div>
        </div>
        <div className="refill-gauge">
          <svg className="grid-patch" style={{ alignSelf: 'flex-start' }} width={COLS * 18 - 9} height={ROWS * 18 - 9} viewBox={`0 0 ${COLS * 18 - 9} ${ROWS * 18 - 9}`} role="img" aria-label={`Tank at ${pct} percent`} data-testid="tank-gauge" data-lit={litRows}>
            {Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (__, c) => (
              <circle key={`${r}-${c}`} cx={4.5 + c * 18} cy={4.5 + r * 18} r={5} fill="var(--display-cream)" opacity={r >= ROWS - litRows ? 1 : r === ROWS - litRows - 1 ? 0.45 : 0.12} />
            )))}
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span className="dots refill-pct" data-testid="tank-pct">{pct}%</span>
            <span className="label">TANK</span>
          </span>
        </div>
      </section>
    </div>
  )
}
