import { useEffect, useMemo, useRef, useState } from 'react'
import { bags, beans, grinders, liveBags, roastAge, type Bag, type Bean, type Grinder } from '../state/coffee'
import { useResource } from '../state/resource'
import { DotIcon } from '../ui/DotIcon'
import { bagLabel } from '../ui/coffeeFormat'
import './sheet.css'
import './coffee.css'

export interface CoffeeChoice { bean: Bean | null; bag: Bag | null; grinder: Grinder | null }

interface Props {
  title: string
  initial: { bagId?: string; coffee?: string; roaster?: string; grinderId?: string }
  onCancel: () => void
  onDone: (choice: CoffeeChoice) => void
  onManage?: () => void // opens the Beans screen; absent where leaving would lose work
}

// The coffee and grinder for a shot: two lists side by side, each with None first. A bean with several bags in use
// shows them under its row; the newest roast is picked unless one is tapped.
export function CoffeeSheet({ title, initial, onCancel, onDone, onManage }: Props) {
  const beanState = useResource(beans)
  const grinderState = useResource(grinders)
  const allBeans = beanState.value ?? []
  const allBags = useResource(bags).value ?? []
  const allGrinders = grinderState.value ?? []

  const shownBeans = useMemo(() => allBeans.filter((b) => !b.archived).sort(byName), [allBeans])
  const shownGrinders = useMemo(() => allGrinders.filter((g) => !g.archived).sort((a, b) => a.model.localeCompare(b.model)), [allGrinders])

  const startBag = allBags.find((b) => b.id === initial.bagId)
  const startBean = startBag ? allBeans.find((b) => b.id === startBag.beanId)
    : allBeans.find((b) => !b.archived && b.name === initial.coffee && (!initial.roaster || b.roaster === initial.roaster))
  const [beanId, setBeanId] = useState<string | null | undefined>(undefined) // undefined: not touched yet
  const [bagId, setBagId] = useState<string | null | undefined>(undefined)
  const [grinderId, setGrinderId] = useState<string | null | undefined>(undefined)
  const chosenBeanId = beanId === undefined ? startBean?.id ?? null : beanId
  const chosenGrinderId = grinderId === undefined ? (allGrinders.some((g) => g.id === initial.grinderId) ? initial.grinderId! : null) : grinderId
  const beanBags = chosenBeanId ? liveBags(allBags, chosenBeanId) : []
  const chosenBagId = bagId === undefined
    ? (startBag && startBag.beanId === chosenBeanId ? startBag.id : beanBags[0]?.id ?? null)
    : bagId

  // Opening on a long list: the current coffee and grinder are brought into view.
  const cols = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !allBeans.length) return
    scrolled.current = true
    cols.current?.querySelectorAll('[aria-checked="true"]').forEach((el) => el.scrollIntoView?.({ block: 'center' }))
  }, [allBeans.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pickBean = (id: string | null) => { setBeanId(id); setBagId(undefined) }
  const done = () => {
    const bean = allBeans.find((b) => b.id === chosenBeanId) ?? null
    const bag = bean ? allBags.find((b) => b.id === chosenBagId && b.beanId === bean.id) ?? null : null
    onDone({ bean, bag, grinder: allGrinders.find((g) => g.id === chosenGrinderId) ?? null })
  }
  // A coffee typed on a shot before beans existed (or one since deleted) stays visible as the current choice.
  const typedOnly = beanId === undefined && !startBean && !!initial.coffee
  const now = new Date()

  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} data-testid="scrim" />
      <section className="sheet coffee-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle"><span /></div>
        <div className="coffee-cols" ref={cols}>
          <div className="coffee-col" role="radiogroup" aria-label="Coffee">
            <span className="label">COFFEE</span>
            <ul className="coffee-list" data-testid="coffee-list">
              <li><Choice name="None" meta={typedOnly ? `NOW: ${[initial.roaster, initial.coffee].filter(Boolean).join(', ').toUpperCase()}` : undefined} checked={!chosenBeanId && !typedOnly} onClick={() => pickBean(null)} /></li>
              {shownBeans.map((bean) => {
                const live = liveBags(allBags, bean.id)
                const age = roastAge(live[0]?.roastDate, now)
                const checked = bean.id === chosenBeanId
                return (
                  <li key={bean.id}>
                    <Choice name={bean.name} meta={[bean.roaster.toUpperCase(), age !== undefined ? `${age} D` : live.length ? '' : 'NO BAG'].filter(Boolean).join(' · ')} checked={checked} onClick={() => pickBean(bean.id)} />
                    {checked && live.length > 1 && (
                      <div className="coffee-bags" role="radiogroup" aria-label={`Bags of ${bean.name}`}>
                        {live.map((bag) => (
                          <button key={bag.id} type="button" className="chip" role="radio" aria-checked={bag.id === chosenBagId} aria-pressed={bag.id === chosenBagId} onClick={() => setBagId(bag.id)}>{bagLabel(bag, now)}</button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
              {beanState.loaded && !shownBeans.length && <li className="coffee-empty">No beans yet.{onManage ? ' Add them in Beans.' : ''}</li>}
            </ul>
          </div>
          <div className="coffee-col narrow" role="radiogroup" aria-label="Grinder">
            <span className="label">GRINDER</span>
            <ul className="coffee-list" data-testid="grinder-list">
              <li><Choice name="None" checked={!chosenGrinderId} onClick={() => setGrinderId(null)} /></li>
              {shownGrinders.map((g) => (
                <li key={g.id}><Choice name={g.model} meta={g.burrs ? g.burrs.toUpperCase() : undefined} checked={g.id === chosenGrinderId} onClick={() => setGrinderId(g.id)} /></li>
              ))}
              {grinderState.loaded && !shownGrinders.length && <li className="coffee-empty">No grinders yet.</li>}
            </ul>
          </div>
        </div>
        <div className="sheet-footer">
          {onManage ? <button type="button" className="chip" onClick={onManage}><DotIcon glyph="beans" />MANAGE BEANS</button> : <span />}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" onClick={done}><DotIcon glyph="check" color="var(--on-primary)" />DONE</button>
          </div>
        </div>
      </section>
    </div>
  )
}

const byName = (a: Bean, b: Bean) => a.name.localeCompare(b.name) || a.roaster.localeCompare(b.roaster)

function Choice({ name, meta, checked, onClick }: { name: string; meta?: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" className="coffee-choice" role="radio" aria-checked={checked} onClick={onClick}>
      <span className="coffee-choice-text">
        <span className="coffee-choice-name">{name}</span>
        {meta && <span className="label one-line">{meta}</span>}
      </span>
      <span className="radio-mark" />
    </button>
  )
}
