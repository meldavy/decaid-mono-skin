import { useEffect, useRef } from 'react'
import { prefsResource, withDefaults } from './prefs'
import { loadProfile, profiles } from './profiles'
import { workflow } from './workflow'

// Settings → Sleep & display → "Load a profile on wake". Only on the change from sleeping to awake that Mono sees
// happen, so opening Mono on an awake machine never loads anything.
export function useWakeProfile(machineState: string | undefined) {
  const previous = useRef(machineState)
  useEffect(() => {
    const was = previous.current
    previous.current = machineState
    if (was !== 'sleeping' || !machineState || machineState === 'sleeping') return
    const id = withDefaults(prefsResource.get().value).wakeProfile
    const record = id ? profiles.get().value?.find((p) => p.id === id) : undefined
    if (record && workflow.get().value?.profile.title !== record.profile.title) void loadProfile(record, workflow.get().value).catch(() => undefined)
  }, [machineState])
}
