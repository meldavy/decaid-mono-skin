import { useEffect, useState } from 'react'

// Short screens (≤ 700 px tall, e.g. a 1000 × 600 tablet) get tighter layouts. Matches the CSS breakpoint in tokens.css.
export const SHORT_QUERY = '(max-height: 700px)'

export function useShort() {
  const [short, setShort] = useState(() => matchMedia(SHORT_QUERY).matches)
  useEffect(() => {
    const mq = matchMedia(SHORT_QUERY)
    const on = () => setShort(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return short
}
