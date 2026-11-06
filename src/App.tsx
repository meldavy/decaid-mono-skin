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
import { Beans, type BeansTab } from './screens/Beans'
import { ShotScreen } from './screens/LiveShot'
import { Settings } from './screens/Settings'
import { Sleep } from './screens/Sleep'
import { RulerSheet } from './sheets/RulerSheet'
import { useCompletionChime } from './ui/chime'
import { useTheme } from './ui/theme'
import { Toasts } from './ui/toasts'
import { useShortcuts } from './useShortcuts'

// Back from a DYE2 page (it opens in place of Mono): ?beans=<tab>&id=<record> reopens the Beans screen there.
function returnTarget(): { tab: BeansTab; id?: string } | null {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('beans')
  if (tab !== 'beans' && tab !== 'grinders' && tab !== 'recipes') return null
  const id = q.get('id') ?? undefined
  q.delete('beans'); q.delete('id')
  const rest = q.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
  return { tab, id }
}

export function App() {
  const prefs = withDefaults(useResource(prefsResource).value)
  const machineState = useLive((l) => l.machine?.state.state)
  const shot = useLive((l) => l.shot)
  const runKind = machineState === 'steam' || machineState === 'hotWater' || machineState === 'flush' ? machineState : null
  const [back] = useState(returnTarget)
  const [screen, setScreen] = useState<'home' | Screen | 'favourites' | 'editor'>(back ? 'beans' : 'home')
  const [favFrom, setFavFrom] = useState<'library' | 'beans'>('library') // which list Favourites shows, and where it goes back to
  const [beansAt, setBeansAt] = useState<{ tab: BeansTab; id?: string }>(back ?? { tab: 'beans' })
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [editFrom, setEditFrom] = useState<'library' | 'home'>('library') // where closing the editor goes back to

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENTS[prefs.accent])
  }, [prefs.accent])
  useTheme(prefs.theme)

  useHeartbeat(machineState)
  useWakeProfile(machineState)
  useCompletionChime(shot ? shot.id ?? String(shot.startedAt) : null, shot?.phase === 'finished', prefs.completionSound)

  const [sheet, setSheet] = useState<SheetKind | null>(null)
  useShortcuts(machineState, !shot && screen === 'home' && !sheet)

  return (
    <>
      {shot ? <ShotScreen /> : null}
      {!shot && screen === 'home' && <Home onOpenSheet={setSheet} onNavigate={setScreen} onEdit={(target) => { setEditing(target); setEditFrom('home'); setScreen('editor') }} onOpenRecipe={(id) => { setBeansAt({ tab: 'recipes', id }); setScreen('beans') }} />}
      {sheet && <RulerSheet kind={sheet} onClose={() => setSheet(null)} />}
      {!shot && screen === 'library' && <Library onBack={() => setScreen('home')} onEdit={(target) => { setEditing(target); setEditFrom('library'); setScreen('editor') }} onManageFavourites={() => { setFavFrom('library'); setScreen('favourites') }} />}
      {!shot && screen === 'favourites' && <Favourites library={favFrom === 'beans' ? 'recipes' : 'profiles'} onBack={() => setScreen(favFrom)} onEdit={(target) => { setEditing(target); setEditFrom('library'); setScreen('editor') }} />}
      {!shot && screen === 'editor' && editing && <Editor key={editing.kind === 'record' ? editing.id : `d${editing.from}`} target={editing} onClose={() => setScreen(editFrom)} />}
      {!shot && screen === 'settings' && <Settings onBack={() => setScreen('home')} />}
      {!shot && screen === 'beans' && <Beans initialTab={beansAt.tab} initialId={beansAt.id} onBack={() => { setBeansAt({ tab: 'beans' }); setScreen('home') }} onManageFavourites={() => { setBeansAt({ tab: 'recipes' }); setFavFrom('beans'); setScreen('favourites') }} onOpenHistory={() => setScreen('history')} />}
      {!shot && screen === 'history' && <History onBack={() => setScreen('home')} onBrewAgain={() => setScreen('home')} />}
      {runKind && <RunModal key={runKind} kind={runKind} />}
      <RefillModal />
      <MachineMessage />
      {machineState === 'sleeping' && <Sleep />}
      <Toasts><ConnectionBanner /></Toasts>
    </>
  )
}
