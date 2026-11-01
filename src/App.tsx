import { useEffect, useState } from 'react'
import { Home, type Screen, type SheetKind } from './screens/Home'
import { ACCENTS, prefsResource, withDefaults } from './state/prefs'
import { useResource } from './state/resource'
import { useHeartbeat } from './state/heartbeat'
import { useLive } from './state/live'
import { useWakeProfile } from './state/wakeProfile'
import { ConnectionBanner } from './overlays/ConnectionBanner'
import { MachineMessage } from './overlays/MachineMessage'
import { RefillModal } from './overlays/RefillModal'
import { RunModal } from './overlays/RunModal'
import { Editor } from './screens/Editor'
import { Favourites } from './screens/Favourites'
import { History } from './screens/History'
import { Library, type EditTarget } from './screens/Library'
import { ShotScreen } from './screens/LiveShot'
import { Settings } from './screens/Settings'
import { Sleep } from './screens/Sleep'
import { RulerSheet } from './sheets/RulerSheet'
import { useCompletionChime } from './ui/chime'
import { Toasts } from './ui/toasts'
import { useShortcuts } from './useShortcuts'

export function App() {
  const prefs = withDefaults(useResource(prefsResource).value)
  const machineState = useLive((l) => l.machine?.state.state)
  const shot = useLive((l) => l.shot)
  const runKind = machineState === 'steam' || machineState === 'hotWater' || machineState === 'flush' ? machineState : null
  const [screen, setScreen] = useState<'home' | Screen | 'favourites' | 'editor'>('home')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [editFrom, setEditFrom] = useState<'library' | 'home'>('library') // where closing the editor goes back to

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENTS[prefs.accent])
  }, [prefs.accent])

  useHeartbeat(machineState)
  useWakeProfile(machineState)
  useCompletionChime(shot ? shot.id ?? String(shot.startedAt) : null, shot?.phase === 'finished', prefs.completionSound)

  const [sheet, setSheet] = useState<SheetKind | null>(null)
  useShortcuts(machineState, !shot && screen === 'home' && !sheet)

  return (
    <>
      {shot ? <ShotScreen /> : null}
      {!shot && screen === 'home' && <Home onOpenSheet={setSheet} onNavigate={setScreen} onEdit={(target) => { setEditing(target); setEditFrom('home'); setScreen('editor') }} />}
      {sheet && <RulerSheet kind={sheet} onClose={() => setSheet(null)} />}
      {!shot && screen === 'library' && <Library onBack={() => setScreen('home')} onEdit={(target) => { setEditing(target); setEditFrom('library'); setScreen('editor') }} onManageFavourites={() => setScreen('favourites')} />}
      {!shot && screen === 'favourites' && <Favourites onBack={() => setScreen('library')} onEdit={(target) => { setEditing(target); setEditFrom('library'); setScreen('editor') }} />}
      {!shot && screen === 'editor' && editing && <Editor key={editing.kind === 'record' ? editing.id : `d${editing.from}`} target={editing} onClose={() => setScreen(editFrom)} />}
      {!shot && screen === 'settings' && <Settings onBack={() => setScreen('home')} />}
      {!shot && screen === 'history' && <History onBack={() => setScreen('home')} onBrewAgain={() => setScreen('home')} />}
      {runKind && <RunModal key={runKind} kind={runKind} />}
      <RefillModal />
      <MachineMessage />
      {machineState === 'sleeping' && <Sleep />}
      <Toasts><ConnectionBanner /></Toasts>
    </>
  )
}
