import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { planStages, type Profile } from '../domain/profile'
import { lastShotLine } from '../domain/history'
import { favourites, SLOT_COUNT } from '../state/favourites'
import { lastShots } from '../state/history'
import { machineConnected, SCALE_STALE_MS, scaleConnected, useLive } from '../state/live'
import { isRunning, machineInfo, requestState, StartBlocked, tare, thermalStatus, type RequestedState } from '../state/machine'
import { DEFAULT_TARGET_TIME, prefsResource, targetTimes, withDefaults } from '../state/prefs'
import { activeProfileId, profiles } from '../state/profiles'
import { useNow, useResource } from '../state/resource'
import { ttrSeconds } from '../state/timeToReady'
import { tankPercent } from '../state/water'
import { workflow } from '../state/workflow'
import { bags, beans, chooseBag, chooseGrinder, grinders, nextCoffee, setGrind } from '../state/coffee'
import { CoffeeSheet } from '../sheets/CoffeeSheet'
import { dye2Selection, recipeSlots, slotEntries } from '../state/recipeSlots'
import { applyRecipe, loadProfileBack, recipeName, recipeProfile, recipes, type Recipe } from '../state/recipes'
import { TextSheet } from '../ui/Sheets'
import { DotChart } from '../ui/DotChart'
import { FavDetail } from './Favourites'
import type { EditTarget } from './Library'
import { slotNo } from './ProfileDetail'
import { DotIcon } from '../ui/DotIcon'
import { DotSpinner } from '../ui/DotSpinner'
import { clock, fixed, NONE, tempLabel, toUnit } from '../ui/format'
import { fitLegend } from '../ui/legend'
import { MAIN_TITLE, SIDE_TITLE, titleStyle } from '../ui/title'
import { snapDown } from '../ui/grid'
import { errorToast, toast } from '../ui/toasts'
import { useShort } from '../ui/useShort'
import { useSize } from '../ui/useSize'
import './home.css'

export type SheetKind = 'temp' | 'dose' | 'yield' | 'time'
export type Screen = 'library' | 'history' | 'settings' | 'beans'

interface Props {
  onOpenSheet: (kind: SheetKind) => void
  onNavigate: (screen: Screen) => void
  onEdit: (target: EditTarget) => void
  onOpenRecipe: (id: string) => void
}

const SETTLE_MS = 500
// The display's inner width: 306 px (34 dots) at 27 px padding; on a short screen the display is 306 px with 18 px
// padding (both on the 9 px grid), so 270 px (30 dots).
const MINI_COLS = 34
const MINI_COLS_SHORT = 30
const MINI_ROWS = 11

// The selected profile's name above the mini plan: right aligned, up to two lines.
const MINI_TITLE_H = 34
// px from one card to the next in the carousel: a 280 px side card (wide, so long names wrap less; only its edge
// shows anyway) plus the 20 px gap, or 14 px on short screens.
const CARD_STEP = 300
const CARD_STEP_SHORT = 294
const MAIN_HALF = 240 // half the main card's 480 px
// Time to ready only once it's two digits: "HEATING · 300 S" doesn't fit the display's top line.
const ttrLabel = (s: number) => (s > 0 && s <= 99 ? ` · ${s} S` : '')
const SNAP_MS = 180 // a card swapped in mid-drag slides to its landing spot in this long
const RESIST = 90 // past the first or last card, the strip gives at most this far
const HEADLINE = { nolink: 'NO LINK', offline: 'NO MACHINE', stale: 'NO DATA', asleep: 'ASLEEP', heating: 'HEATING', ready: 'READY', busy: 'BUSY' } as const

export function Home({ onOpenSheet, onNavigate, onEdit, onOpenRecipe }: Props) {
  const live = useLive((l) => l)
  const now = useNow(1_000)
  const prefs = withDefaults(useResource(prefsResource).value)
  const wf = useResource(workflow).value
  const records = useResource(profiles).value ?? []
  const slots = useResource(favourites).value ?? new Array<string | null>(SLOT_COUNT).fill(null)
  const targets = useResource(targetTimes).value ?? {}
  const notes = useResource(recipeSlots).value
  const allRecipes = useResource(recipes).value ?? []
  const selection = useResource(dye2Selection).value

  // The mini plan chart is pinned to the display grid: 27 px from the left, its top a whole number of rows.
  const [displayBox, displaySize] = useSize<HTMLElement>()
  const short = useShort()
  const displayPad = short ? 18 : 27
  const step = short ? CARD_STEP_SHORT : CARD_STEP
  const miniTop = snapDown(displaySize.height - displayPad - MINI_ROWS * 9) - MINI_TITLE_H
  const connected = machineConnected(live.devices)
  const hasScale = scaleConnected(live.devices)
  const state = live.machine?.state.state
  const linkOpen = live.link === 'open'
  const thermal = thermalStatus(live.machine, connected, live.machineAt, now, linkOpen)
  // Without a link nothing on the display is current, so show nothing rather than old numbers.
  const showLive = linkOpen && connected && !!live.machine
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records])
  const recipesById = useMemo(() => new Map(allRecipes.map((r) => [r.id, r])), [allRecipes])
  // A slot holds a profile or a recipe (see state/recipeSlots). A recipe's card is the active one while DYE2 says
  // it's the selected recipe; otherwise the profile on the machine marks its plain profile card.
  const entries = useMemo(() => slotEntries(slots, notes, new Set(recipesById.keys())), [slots, notes, recipesById])
  const profileSlots = useMemo(() => entries.map((e) => (e?.kind === 'profile' ? e.id : null)), [entries])
  const activeId = activeProfileId(wf?.profile, records, profileSlots)
  const recipeActive = selection?.kind === 'recipe' ? entries.findIndex((e) => e?.kind === 'recipe' && e.id === selection.id) : -1
  const activeSlot = recipeActive >= 0 ? recipeActive : activeId ? profileSlots.indexOf(activeId) : -1
  // The machine's profile isn't a favourite: it gets a sixth card at the end, until a favourite is chosen.
  // Card objects stay the same between renders unless the favourites, profiles or machine profile change, so the
  // cards (and their charts) aren't redrawn on every live reading.
  const cards = useMemo<(Card | null)[]>(() => {
    const extra: Card | null = wf && activeSlot < 0
      ? { id: activeId, profile: activeId ? byId.get(activeId)!.profile : wf.profile }
      : null
    const card = (e: (typeof entries)[number]): Card | null => {
      if (e?.kind === 'recipe') {
        const recipe = recipesById.get(e.id)!
        const profile = recipeProfile(recipe)
        return profile ? { id: null, profile, recipe } : null
      }
      return e && byId.get(e.id) ? { id: e.id, profile: byId.get(e.id)!.profile } : null
    }
    return [...entries.map(card), ...(extra ? [extra] : [])]
  }, [entries, recipesById, byId, wf, activeId, activeSlot])
  const activeIndex = activeSlot >= 0 ? activeSlot : wf ? cards.length - 1 : -1

  // Carousel focus. Follows the machine's profile unless the person is mid-swipe.
  const [focus, setFocus] = useState(Math.max(0, activeIndex))
  const [loading, setLoading] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const userMoved = useRef(false)
  useEffect(() => { void lastShots.refresh() }, []) // back from a shot: show it
  useEffect(() => {
    if (!userMoved.current && activeIndex >= 0) setFocus(activeIndex)
  }, [activeIndex])
  const lastIndex = cards.length - 1

  const settleOn = (index: number) => {
    userMoved.current = true
    swapped.current = true
    setSettling(true)
    setFocus(index)
    clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(async () => {
      const recipe = index < SLOT_COUNT ? cards[index]?.recipe : undefined
      if (recipe) {
        if (index === activeSlot) { userMoved.current = false; setSettling(false); return }
        setLoading(recipe.id)
        try {
          await applyRecipe(recipe)
          await dye2Selection.refresh()
        } catch (error) {
          errorToast(error)
        } finally {
          setLoading(null)
          setSettling(false)
          userMoved.current = false
        }
        return
      }
      const id = index < SLOT_COUNT ? profileSlots[index] : null
      const record = id ? byId.get(id) : undefined
      if (!record || (record.id === activeId && recipeActive < 0)) {
        userMoved.current = false
        setSettling(false)
        return
      }
      setLoading(record.id)
      try {
        await loadProfileBack(record, wf) // from a recipe: the profile settings come back too
        if (selection?.kind === 'recipe') await dye2Selection.refresh()
      } catch (error) {
        errorToast(error)
      } finally {
        setLoading(null)
        setSettling(false)
        userMoved.current = false
      }
    }, SETTLE_MS)
  }
  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // Dragging pulls the next card in once it's dragged half a card step: it becomes the main card there and then,
  // landing half a step short of centre on the side it came from, so the finger carrying on brings it to the middle
  // (one card per step of travel). Going back the other way needs the same half step again. The strip always follows
  // the finger directly; a swap adds a short snap on top (the card expands where it is, then slides to its landing
  // spot), so a fast drag never leaves the strip behind. Past the first or last card the strip resists. The profile
  // loads once the finger lifts.
  const track = useRef<HTMLDivElement>(null)
  const swapped = useRef(false) // once the person has changed cards, a card coming to the middle grows into place
  const restX = -(focus * step) - MAIN_HALF
  const swipe = useRef<{ x: number; id: number; dragging: boolean; focus: number; dir: number; fingerX: number; snap: number; snapAt: number; placed: number; raf: number; before: number | null } | null>(null)
  const place = (x: number, animate: boolean) => {
    if (!track.current) return
    track.current.style.transition = animate ? '' : 'none'
    track.current.style.transform = `translateX(${x}px)`
  }
  const fingerOffset = (s: NonNullable<typeof swipe.current>) => {
    const o = (s.fingerX - s.x) * 0.8
    const atEnd = (o > 0 && s.focus === 0) || (o < 0 && s.focus === lastIndex)
    return atEnd ? Math.sign(o) * RESIST * (1 - RESIST / (RESIST + Math.abs(o))) : o // eases off towards RESIST px
  }
  const snapLeft = (s: NonNullable<typeof swipe.current>, now: number) => {
    const k = Math.min(1, (now - s.snapAt) / SNAP_MS)
    return s.snap * (1 - k) ** 3 // ease-out
  }
  const follow = (s: NonNullable<typeof swipe.current>, now: number) => {
    if (s.before !== null) return // a swap is on its way to the screen; the strip waits for it (see below)
    s.placed = -(s.focus * step) - MAIN_HALF + fingerOffset(s) + snapLeft(s, now)
    place(s.placed, false)
  }
  const tick = () => {
    const s = swipe.current
    if (!s) return
    const now = performance.now()
    follow(s, now)
    s.raf = now - s.snapAt < SNAP_MS ? requestAnimationFrame(tick) : 0
  }
  const centreOf = (el: Element | null | undefined) => { const r = el?.getBoundingClientRect(); return r ? r.left + r.width / 2 : 0 }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: e.clientX, id: e.pointerId, dragging: false, focus, dir: 0, fingerX: e.clientX, snap: 0, snapAt: 0, placed: restX, raf: 0, before: null }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current
    if (!s || s.id !== e.pointerId) return
    s.fingerX = e.clientX
    const dx = e.clientX - s.x
    // Capture only once the gesture becomes a drag, so taps still reach the cards.
    if (!s.dragging && Math.abs(dx) > 10) { s.dragging = true; e.currentTarget.setPointerCapture?.(e.pointerId) }
    if (!s.dragging) return
    const swapAt = step / 2 // half a card step: the next card comes in once it's dragged halfway
    const land = step / 2 // where a new main card lands: this far short of centre, toward where it came from
    // Reversing the last swap needs swapAt beyond where the card landed.
    const need = (d: number) => swapAt + (s.dir === -d ? land : 0)
    const d = dx > need(1) ? 1 : dx < -need(-1) ? -1 : 0 // +1: finger moving right, the card on the left comes in
    const next = s.focus - d
    const now = performance.now()
    if (d && next >= 0 && next <= lastIndex && s.before === null && track.current) {
      s.before = centreOf(track.current.children[next]?.querySelector('.card-side')) // where it is on screen now
      s.focus = next
      s.dir = d
      s.x = e.clientX + d * land
      userMoved.current = true
      swapped.current = true
      setFocus(next)
    }
    follow(s, now)
  }
  // The swap has reached the page (before it's painted): start the snap wherever keeps the new main card where it
  // was on screen, so it expands in place, then let it run out over SNAP_MS.
  useLayoutEffect(() => {
    const s = swipe.current
    if (!s || s.before === null || !track.current) return
    place(s.placed, false) // React just reset the strip to the new rest position
    const after = centreOf(track.current.children[s.focus]?.querySelector('.card-main'))
    s.snap = s.placed + (s.before - after) - (-(s.focus * step) - MAIN_HALF + fingerOffset(s))
    s.before = null
    s.snapAt = performance.now()
    follow(s, s.snapAt)
    if (!s.raf) s.raf = requestAnimationFrame(tick)
  }, [focus])
  const release = (s: NonNullable<typeof swipe.current>) => {
    cancelAnimationFrame(s.raf)
    s.before = null
    place(-(s.focus * step) - MAIN_HALF, true)
    settleOn(s.focus)
  }
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s || s.id !== e.pointerId || !s.dragging) return
    release(s)
  }
  const onPointerCancel = () => { const s = swipe.current; swipe.current = null; if (s?.dragging) release(s) }
  // Stable handlers, so the memoised cards don't redraw just because Home re-rendered.
  const settleRef = useRef(settleOn)
  settleRef.current = settleOn
  const selectCard = useCallback((i: number) => settleRef.current(i), [])
  const openCard = useCallback((id: string) => setDetailId(id), [])
  const openRecipeRef = useRef(onOpenRecipe)
  openRecipeRef.current = onOpenRecipe
  const openRecipe = useCallback((id: string) => openRecipeRef.current(id), [])

  const [starting, setStarting] = useState<RequestedState | null>(null)
  const startingRef = useRef(false) // state updates too late to stop taps in the same frame
  const start = async (target: RequestedState) => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(target)
    try {
      await requestState(target)
    } catch (error) {
      if (error instanceof StartBlocked) toast(error.message, 'error')
      else errorToast(error)
    } finally {
      startingRef.current = false
      setStarting(null)
    }
  }

  // A machine with a group-head controller starts on the group head (as in Streamline): no start tiles here.
  const ghc = useResource(machineInfo).value?.GHC === true
  const canStart = !ghc && connected && live.link === 'open' && state !== 'sleeping' && !isRunning(state) && !starting
  const brewReady = canStart && !loading && !settling
  const weight = live.scale?.weight
  const tank = live.water?.currentLevel
  const units = prefs.units
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = detailId ? records.find((r) => r.id === detailId) : undefined
  const targetTime = activeId && targets[activeId] ? targets[activeId] : DEFAULT_TARGET_TIME
  const espressoTemp = wf?.profile.steps[0]?.temperature
  const coffee = nextCoffee(wf?.context, { beans: useResource(beans).value ?? [], bags: useResource(bags).value ?? [], grinders: useResource(grinders).value ?? [] })
  const [coffeeOpen, setCoffeeOpen] = useState(false)
  const [grindOpen, setGrindOpen] = useState(false)
  const coffeeLine = [coffee.coffee, coffee.grinderName].filter(Boolean).join(' · ')

  return (
    <div className="home">
      <section className="home-display display" ref={displayBox} aria-label="Live machine display">
        <div className="headline dots">
          {/* Heating is a wait: rust, with a dot spinner. */}
          <span className={`thermal${thermal === 'heating' ? ' heating' : ''}`}>
            {thermal === 'heating' && <DotSpinner color="var(--rust-on-display)" />}
            <span data-testid="thermal">{HEADLINE[thermal]}{thermal === 'heating' ? ttrLabel(ttrSeconds(live.ttr, now)) : ''}</span>
          </span>
          <span data-testid="home-clock">{clock(new Date(now), prefs.clock)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="label">GROUP HEAD {tempLabel(units)}</span>
          <span className="hero dots" data-testid="group-temp">{showLive ? fixed(toUnit(live.machine!.groupTemperature, units), 1) : NONE}</span>
        </div>
        <div className="rows">
          <div className="row"><span className="label">STEAM {tempLabel(units)}</span><span className="dots" data-testid="steam-temp">{showLive ? fixed(toUnit(live.machine!.steamTemperature, units), 0) : NONE}</span></div>
          <div className="row row-with-button">
            <button type="button" className="row-button" aria-label="Tare scale" disabled={!hasScale || !linkOpen} onClick={() => tare().catch(errorToast)}>
              <span className="label">SCALE G</span><span className="dots" data-testid="weight">{linkOpen && hasScale && now - live.scaleAt < SCALE_STALE_MS ? fixed(weight, 1) : NONE}</span>
            </button>
          </div>
          <div className="row"><span className="label">TANK %</span><span className="dots" data-testid="tank">{showLive ? fixed(tankPercent(tank), 0) : NONE}</span></div>
        </div>
        {/* In-flow placeholder; the plan itself is pinned to the display's 9 px grid below. */}
        <div style={{ height: MINI_ROWS * 9 + MINI_TITLE_H }} aria-hidden />
        <div className="mini-plan" style={{ top: miniTop }}>
          <div className="label mini-plan-title" data-testid="plan-title">{wf?.profile.title ?? ''}</div>
          {wf && <DotChart stages={planStages(wf.profile)} mode="field" theme="dark" cols={short ? MINI_COLS_SHORT : MINI_COLS} rows={MINI_ROWS} label="Selected profile plan" />}
        </div>
      </section>

      <section className={`home-main${ghc ? ' ghc' : ''}`}>
        <header className="home-header">
          <span />
          <nav className="home-nav">
            <button type="button" className="nav-button two-lines" aria-label="Beans and recipes" onClick={() => onNavigate('beans')}><DotIcon glyph="beans" /><span className="label nav-two-lines">BEANS &amp;{' '}<br />RECIPES</span></button>
            <button type="button" className="nav-button" aria-label="All profiles" onClick={() => onNavigate('library')}><DotIcon glyph="profiles" /><span className="label">PROFILES</span></button>
            <button type="button" className="nav-button" aria-label="History" onClick={() => onNavigate('history')}><DotIcon glyph="history" /><span className="label">HISTORY</span></button>
            <button type="button" className="nav-button" aria-label="Sleep" disabled={!connected || state === 'sleeping'} onClick={() => start('sleeping')}><DotIcon glyph="zz" /><span className="label">SLEEP</span></button>
            <button type="button" className="nav-button" aria-label="Settings" onClick={() => onNavigate('settings')}><DotIcon glyph="settings" /><span className="label">SETTINGS</span></button>
          </nav>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* The next shot's coffee and grinder: quiet, above the card, tap to choose. */}
          <button type="button" className={`coffee-line${coffeeLine ? '' : ' empty'}`} aria-label={coffeeLine ? `Coffee and grinder: ${coffeeLine}` : 'Choose coffee and grinder'} onClick={() => setCoffeeOpen(true)} data-testid="coffee-line">
            <span className="one-line">{coffeeLine || 'Choose coffee and grinder'}</span>
          </button>
          <div className="carousel" aria-label="Favourite profiles" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
            <div className="carousel-track" ref={track} style={{ transform: `translateX(${restX}px)` }}>
              {/* Every card is drawn in both forms once; a swap only flips which one shows, so nothing is redrawn mid-swipe. */}
              {cards.map((card, i) => (
                <div key={i} className={`card-slot${i === focus ? ' is-main' : ''}${swapped.current ? ' grow' : ''}`}>
                  <MainCard index={i} count={cards.length} card={card} shown={i === focus} active={i === activeIndex} loading={!!loading && loading === (card?.recipe?.id ?? card?.id)} onOpen={card?.recipe ? openRecipe : card?.id && byId.has(card.id) ? openCard : undefined} />
                  <SideCard index={i} card={card} shown={i !== focus} before={i < focus} onSelect={selectCard} />
                </div>
              ))}
            </div>
          </div>
          <div className="pager" aria-label={`Profile ${focus + 1} of ${cards.length}`}>
            {cards.map((_, i) => <span key={i} aria-current={i === focus} />)}
          </div>
        </div>

        <div className="values">
          <Value label={`TEMP ${tempLabel(units)}`} value={espressoTemp === undefined ? NONE : fixed(toUnit(espressoTemp, units), 0)} onClick={() => onOpenSheet('temp')} testId="value-temp" />
          <Value label="DOSE G" value={fixed(wf?.context?.targetDoseWeight, 1)} onClick={() => onOpenSheet('dose')} testId="value-dose" />
          <Value label="GRIND" value={coffee.grind ?? NONE} onClick={() => setGrindOpen(true)} testId="value-grind" />
          <Value label="YIELD G" value={fixed(wf?.context?.targetYield, 1)} onClick={() => onOpenSheet('yield')} testId="value-yield" />
          <Value label="TIME S" value={String(targetTime)} onClick={() => onOpenSheet('time')} testId="value-time" />
        </div>

        {!ghc && <div className="actions">
          <div className="tile-row">
            <button type="button" className="tile" disabled={!canStart} onClick={() => start('steam')}><DotIcon glyph="steam" />STEAM</button>
            <button type="button" className="tile" disabled={!canStart} onClick={() => start('hotWater')}><DotIcon glyph="water" />WATER</button>
            <button type="button" className="tile" disabled={!canStart} onClick={() => start('flush')}><DotIcon glyph="flush" />FLUSH</button>
          </div>
          <button type="button" className="primary" disabled={!brewReady} onClick={() => start('espresso')}><DotIcon glyph="brew" color="var(--on-primary)" primary />BREW</button>
        </div>}
      </section>
      {coffeeOpen && (
        <CoffeeSheet
          title="Coffee and grinder for the next shot"
          initial={{ bagId: wf?.context?.beanBatchId as string | undefined, coffee: coffee.coffee, roaster: coffee.roaster, grinderId: wf?.context?.grinderId as string | undefined }}
          onCancel={() => setCoffeeOpen(false)}
          onManage={() => { setCoffeeOpen(false); onNavigate('beans') }}
          onDone={(c) => { setCoffeeOpen(false); void Promise.all([chooseBag(c.bean, c.bag), chooseGrinder(c.grinder)]).catch(errorToast) }}
        />
      )}
      {grindOpen && <TextSheet label="GRIND · NEXT SHOT" value={coffee.grind ?? ''} multiline={false} maxLength={24} onCancel={() => setGrindOpen(false)} onDone={(v) => { setGrindOpen(false); if (v !== (coffee.grind ?? '')) void setGrind(v).catch(errorToast) }} />}
      {detail && <FavDetail record={detail} slots={slots} units={units} onClose={() => setDetailId(null)} onEdit={onEdit} />}
    </div>
  )
}

function Value({ label, value, onClick, testId }: { label: string; value: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="value" onClick={onClick} data-testid={testId}>
      <span className="label">{label}</span>
      <span className="v one-line">{value}</span>
    </button>
  )
}

interface Card { id: string | null; profile: Profile; recipe?: Recipe }


// A card's hidden form stays drawn (so showing it costs nothing) but is out of reach: no taps, focus or screen reader.
const SideCard = memo(function SideCard({ index, card, shown, before, onSelect }: { index: number; card: Card | null; shown: boolean; before: boolean; onSelect: (index: number) => void }) {
  if (!card) {
    return (
      <div className={`card-side empty${before ? ' before' : ''}`} aria-label={shown ? `Slot ${index + 1}, empty` : undefined} aria-hidden={!shown || undefined}>
        <span className="label">{slotNo(index)}</span>
        <span className="name" style={{ color: 'var(--taupe)' }}>Empty</span>
        <span />
      </div>
    )
  }
  const title = card.recipe ? recipeName(card.recipe) : card.profile.title
  return (
    <button type="button" className={`card-side${before ? ' before' : ''}`} onClick={() => onSelect(index)} aria-label={shown ? `Slot ${index + 1}, ${title}` : undefined} aria-hidden={!shown || undefined} tabIndex={shown ? undefined : -1}>
      <span className="label">{slotNo(index)}{card.recipe ? ' · RECIPE' : ''}</span>
      <span className="name" style={titleStyle(title, SIDE_TITLE)}>{title || 'Untitled'}</span>
      <DotChart stages={planStages(card.profile)} mode="field" cols={26} rows={6} label={`${title} plan`} />
    </button>
  )
})

// Tapping the card in front opens its details (read-only).
const MainCard = memo(function MainCard({ index, count, card, shown, active, loading, onOpen: open }: { index: number; count: number; card: Card | null; shown: boolean; active: boolean; loading: boolean; onOpen?: (id: string) => void }) {
  const openId = card?.recipe?.id ?? card?.id
  const onOpen = shown && open && openId ? () => open(openId) : undefined
  const title = card?.recipe ? recipeName(card.recipe) : card?.profile.title
  const last = useResource(lastShots)
  // A recipe's line says which profile it brews; a profile's says when it was last brewed.
  const line = !card ? 'Add one in Manage favourites' : card.recipe ? `Recipe · ${card.profile.title}` : last.loaded && last.value ? lastShotLine(last.value.byTitle.get(card.profile.title), last.value.all, new Date()) : ''
  return (
    <article className="card-main" aria-label={!shown ? undefined : title ? `Slot ${index + 1}, ${title}${active ? ', selected' : ''}` : `Slot ${index + 1}, empty`} data-testid={shown ? 'main-card' : undefined} aria-hidden={!shown || undefined} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} aria-haspopup={onOpen ? 'dialog' : undefined} onClick={onOpen} onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }} style={onOpen ? { cursor: 'pointer' } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span className="label">{slotNo(index)} / {String(count).padStart(2, '0')}{loading ? ' · LOADING' : active ? ' · SELECTED' : ''}</span>
        <span className="title" title={title} style={title ? titleStyle(title, MAIN_TITLE) : undefined}>{card ? title || 'Untitled' : 'Empty slot'}</span>
        <span className="provenance one-line" data-testid={shown ? 'provenance' : undefined}>{line}</span>
      </div>
      {card && <ChartWithLegend card={card} />}
    </article>
  )
})

const LEGEND_COLUMNS = 2
const LEGEND_LINES = 2

const ChartWithLegend = memo(function ChartWithLegend({ card }: { card: Card }) {
  const stages = planStages(card.profile)
  const legend = fitLegend(stages, LEGEND_COLUMNS, LEGEND_LINES)
  const short = useShort()
  return (
    <div className="card-chart">
      <DotChart stages={stages} cols={44} rows={short ? 9 : 13} axis rail label={`${card.profile.title}: pressure and flow by stage`} />
      <div className="legend label" data-testid="legend">
        {legend.items.map((it) => (
          <span key={it.no} className="legend-item">
            <span className="legend-dot" style={{ background: it.tone ? 'var(--line-mid)' : 'var(--taupe)' }} />
            <span>{it.no}</span>
            <span className="legend-name one-line" title={it.name}>{it.name}</span>
            <span>{it.dur}</span>
          </span>
        ))}
        {legend.more > 0 && <span className="legend-item">+{legend.more} MORE</span>}
      </div>
    </div>
  )
})
