import { useEffect, useRef, useState } from 'react'
import { machineConnected, scaleConnected, useLive } from '../state/live'
import { toast } from '../ui/toasts'

// A pill at the top of every screen while Decaid or the machine can't be reached. Writes made meanwhile
// fail with an error toast; the banner goes by itself once things are back.
export const BANNER_GRACE_MS = 1_500

export function ConnectionBanner() {
  const link = useLive((l) => l.link)
  const devices = useLive((l) => l.devices)
  const problem = link !== 'open' ? 'link' : devices.length && !machineConnected(devices) ? 'machine' : null
  const [shown, setShown] = useState<typeof problem>(null)

  // A short grace period, so a blip or the first connection doesn't flash a banner.
  useEffect(() => {
    if (!problem) { setShown(null); return }
    const t = setTimeout(() => setShown(problem), BANNER_GRACE_MS)
    return () => clearTimeout(t)
  }, [problem])

  // The scale coming and going is worth a word, but not a banner (many people brew without one).
  const hasScale = scaleConnected(devices)
  const hadScale = useRef<boolean | null>(null)
  useEffect(() => {
    if (link !== 'open' || !devices.length) return
    if (hadScale.current === true && !hasScale) toast('Scale disconnected')
    if (hadScale.current === false && hasScale) toast('Scale connected')
    hadScale.current = hasScale
  }, [hasScale, link, devices.length])

  if (!shown) return null
  return (
    <div className="conn-banner" role="status" data-testid="connection-banner">
      <span className="conn-dot" />
      {shown === 'link' ? 'CAN’T REACH DECAID · RECONNECTING…' : 'THE MACHINE ISN’T CONNECTED'}
    </div>
  )
}
