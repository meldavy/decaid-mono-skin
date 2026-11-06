import { useEffect, useRef } from 'react'
import { decideKey, keyboardResource, withKeyDefaults } from './state/keyboard'
import { GHC_MESSAGE, machineInfo, requestState, StartBlocked } from './state/machine'
import { profiles } from './state/profiles'
import { loadProfileBack } from './state/recipes'
import { useResource } from './state/resource'
import { workflow } from './state/workflow'
import { errorToast, toast } from './ui/toasts'

// Listens for shortcut keys and acts on them (rules in state/keyboard.ts).
export function useShortcuts(machineState: string | undefined, onHome: boolean) {
  const config = withKeyDefaults(useResource(keyboardResource).value)
  const latest = useRef({ config, machineState, onHome })
  latest.current = { config, machineState, onHome }
  const busy = useRef(false)

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const { config, machineState, onHome } = latest.current
      // A sheet or alert over the screen blocks start keys (the running modal doesn't count: Stop must work).
      const dialogOpen = !!document.querySelector('[aria-modal="true"]:not([data-testid="run-modal"]), [role="alertdialog"]')
      const decision = decideKey(e, config, { machineState, onHome, dialogOpen })
      if (decision.kind === 'none') return
      e.preventDefault()
      if (busy.current) return
      busy.current = true
      try {
        if (decision.kind === 'stop') await requestState('idle')
        else if (decision.kind === 'start' && decision.action !== 'sleep' && machineInfo.get().value?.GHC === true) toast(GHC_MESSAGE, 'error')
        else if (decision.kind === 'start') await requestState(decision.action === 'sleep' ? 'sleeping' : decision.action)
        else {
          const record = profiles.get().value?.find((p) => p.id === decision.profileId)
          if (record) await loadProfileBack(record, workflow.get().value)
        }
      } catch (error) {
        if (error instanceof StartBlocked) toast(error.message, 'error')
        else errorToast(error)
      } finally {
        busy.current = false
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
