import { useEffect } from 'react'
import type { Prefs } from '../state/prefs'

// Puts the chosen theme on <html data-theme>, which tokens.css reads. 'auto' follows the tablet's dark setting, live.
export function useTheme(theme: Prefs['theme']) {
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'auto') {
      root.dataset.theme = theme
      return
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { root.dataset.theme = query.matches ? 'dark' : 'light' }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])
}
