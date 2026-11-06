import { useEffect, useMemo, useRef, useState } from 'react'
import { planStages } from '../domain/profile'
import { currentGateway } from '../api/gateway'
import { bags, beans, chooseBag, chooseGrinder, deleteBean, deleteGrinder, grinders, liveBags, roastAge, updateBag, type Bag, type Bean, type Grinder } from '../state/coffee'
import { prefsResource, withDefaults } from '../state/prefs'
import { applyRecipe, dye2Loaded, dye2PageUrl, recipeCoffee, recipeGrind, recipeName, recipeProfile, recipes, type Recipe } from '../state/recipes'
import { useResource } from '../state/resource'
import { plugins } from '../state/settings'
import { workflow } from '../state/workflow'
import { bagLabel } from '../ui/coffeeFormat'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DotChart } from '../ui/DotChart'
import { DotIcon } from '../ui/DotIcon'
import { errorToast, toast } from '../ui/toasts'
import { BagForm, BeanForm, GrinderForm } from './coffeeForms'
import { RecipeView } from './RecipeView'
import { ShotPicker } from './History'
import './library.css'
import './coffee.css'

// Beans, grinders and recipes, laid out like Profiles: tabs, a list, the chosen one's details with its buttons.
// Beans and grinders are Decaid's records; recipes are DYE2's (see state/recipes.ts).

export type BeansTab = 'beans' | 'grinders' | 'recipes'
type Sort = 'recent' | 'name'

interface Props {
  initialTab?: BeansTab
  initialId?: string
  onBack: () => void
  onManageFavourites: () => void
  onOpenHistory: () => void
}

export function Beans({ initialTab = 'beans', initialId, onBack, onManageFavourites, onOpenHistory }: Props) {
  const allBeans = useResource(beans).value ?? []
  const allBags = useResource(bags).value ?? []
  const allGrinders = useResource(grinders).value ?? []
  const allRecipes = useResource(recipes).value ?? []
  const hasDye2 = dye2Loaded(useResource(plugins).value)
  const wf = useResource(workflow).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const [tab, setTab] = useState<BeansTab>(initialTab)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<null | { kind: 'bean'; bean: Bean | null } | { kind: 'bag'; bean: Bean; bag: Bag | null } | { kind: 'grinder'; grinder: Grinder | null }>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'bean'; bean: Bean } | { kind: 'grinder'; grinder: Grinder }>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => { void Promise.all([beans.refresh(), bags.refresh(), grinders.refresh(), recipes.refresh()]) }, [])

  const ctx = wf?.context ?? {}
  const nextBag = allBags.find((b) => b.id === ctx.beanBatchId)
  const nextBeanId = nextBag?.beanId
  const nextGrinderId = typeof ctx.grinderId === 'string' ? ctx.grinderId : undefined
  const now = new Date()

  const shownBeans = allBeans.filter((b) => !b.archived)
  const shownGrinders = allGrinders.filter((g) => !g.archived)
  const counts = { beans: shownBeans.length, grinders: shownGrinders.length, recipes: allRecipes.length }
  const q = query.trim().toLowerCase()
  const match = (...parts: (string | null | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q))
  const newest = (a: { updatedAt?: string; capturedAt?: string | null }, b: { updatedAt?: string; capturedAt?: string | null }) => String(b.updatedAt ?? b.capturedAt ?? '').localeCompare(String(a.updatedAt ?? a.capturedAt ?? ''))

  const beanRows = useMemo(() => shownBeans.filter((b) => match(b.name, b.roaster, b.country, b.notes))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : newest(a, b)) || a.name.localeCompare(b.name)), [allBeans, q, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const grinderRows = useMemo(() => shownGrinders.filter((g) => match(g.model, g.burrs))
    .sort((a, b) => (sort === 'name' ? a.model.localeCompare(b.model) : newest(a, b)) || a.model.localeCompare(b.model)), [allGrinders, q, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const recipeRows = useMemo(() => allRecipes.filter((r) => match(recipeName(r), recipeCoffee(r), r.profileTitle))
    .sort((a, b) => (sort === 'name' ? recipeName(a).localeCompare(recipeName(b)) : newest(a, b)) || recipeName(a).localeCompare(recipeName(b))), [allRecipes, q, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const ids = tab === 'beans' ? beanRows.map((b) => b.id) : tab === 'grinders' ? grinderRows.map((g) => g.id) : recipeRows.map((r) => r.id)
  const selected = (selectedId && ids.includes(selectedId) ? selectedId : null)
    ?? (tab === 'beans' && nextBeanId && ids.includes(nextBeanId) ? nextBeanId : null)
    ?? (tab === 'grinders' && nextGrinderId && ids.includes(nextGrinderId) ? nextGrinderId : null)
    ?? ids[0] ?? null

  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => { listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selected, tab, query])

  const run = async (work: () => Promise<unknown>, done?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await work()
      if (done) toast(done)
    } catch (error) {
      errorToast(error)
    } finally {
      setBusy(false)
    }
  }
  const switchTab = (t: BeansTab) => { setTab(t); setSelectedId(null); setQuery('') }
  const openNew = () => (tab === 'beans' ? setForm({ kind: 'bean', bean: null }) : tab === 'grinders' ? setForm({ kind: 'grinder', grinder: null }) : setPicking(true))
  const editInDye2 = (r: Recipe) => { window.location.href = dye2PageUrl(currentGateway().http, 'recipe-edit', { id: r.id }, `?beans=recipes&id=${encodeURIComponent(r.id)}`) }

  const noun = tab === 'beans' ? 'COFFEES' : tab === 'grinders' ? 'GRINDERS' : 'RECIPES'
  const bean = tab === 'beans' ? beanRows.find((b) => b.id === selected) : undefined
  const grinder = tab === 'grinders' ? grinderRows.find((g) => g.id === selected) : undefined
  const recipe = tab === 'recipes' ? recipeRows.find((r) => r.id === selected) : undefined

  return (
    <div className="library beans" data-testid="beans">
      <header className="lib-header">
        <button type="button" className="icon-button ringed" aria-label="Back to home" onClick={onBack}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
        <h1 className="lib-title">Beans</h1>
        <label className="lib-search">
          <DotIcon glyph="search" color="var(--taupe)" />
          <input type="search" aria-label={`Search ${noun.toLowerCase()}`} placeholder={`SEARCH ${counts[tab]} ${noun}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="lib-clear" aria-label="Clear search" onClick={() => setQuery('')}><DotIcon glyph="close" color="var(--taupe)" /></button>}
        </label>
        <button type="button" className="pill" disabled={tab === 'recipes' && !hasDye2} onClick={openNew}><DotIcon glyph="plus" />NEW</button>
      </header>

      <nav className="lib-filters" aria-label="Kinds">
        <div className="chips">
          {([['beans', 'BEANS'], ['grinders', 'GRINDERS'], ['recipes', 'RECIPES']] as const).map(([t, label]) => (
            <button key={t} type="button" className="chip" aria-pressed={tab === t} onClick={() => switchTab(t)}>{label} {counts[t]}</button>
          ))}
        </div>
        <div className="chips">
          <button type="button" className="chip bare" onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))} data-testid="sort">SORT · {sort === 'recent' ? 'RECENT' : 'NAME'}</button>
          <button type="button" className="chip manage" onClick={onManageFavourites}>
            <svg width={45} height={9} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={4.5 + i * 9} cy={4.5} r={2.6} fill="var(--brown)" />)}</svg>
            MANAGE FAVOURITES
          </button>
        </div>
      </nav>

      <div className="lib-body">
        <ul className="lib-list" aria-label={noun.toLowerCase()} ref={listRef}>
          {tab === 'beans' && beanRows.map((b) => {
            const age = roastAge(liveBags(allBags, b.id)[0]?.roastDate, now)
            return (
              <li key={b.id}>
                <button type="button" className="lib-row" aria-current={selected === b.id} aria-label={b.name} onClick={() => setSelectedId(b.id)}>
                  <span className="lib-row-text">
                    <span className="lib-row-name one-line">{b.name}</span>
                    <span className="label one-line">{[b.roaster, age !== undefined ? `${age} D` : '', b.decaf ? 'DECAF' : ''].filter(Boolean).join(' · ').toUpperCase()}</span>
                  </span>
                  <span className="label lib-slot">{b.id === nextBeanId ? '● NEXT SHOT' : ''}</span>
                </button>
              </li>
            )
          })}
          {tab === 'grinders' && grinderRows.map((g) => (
            <li key={g.id}>
              <button type="button" className="lib-row" aria-current={selected === g.id} aria-label={g.model} onClick={() => setSelectedId(g.id)}>
                <span className="lib-row-text">
                  <span className="lib-row-name one-line">{g.model}</span>
                  <span className="label one-line">{[g.burrs, g.burrType].filter(Boolean).join(' · ').toUpperCase()}</span>
                </span>
                <span className="label lib-slot">{g.id === nextGrinderId ? '● NEXT SHOT' : ''}</span>
              </button>
            </li>
          ))}
          {tab === 'recipes' && recipeRows.map((r) => {
            const p = recipeProfile(r)
            return (
              <li key={r.id}>
                <button type="button" className="lib-row" aria-current={selected === r.id} aria-label={recipeName(r)} onClick={() => setSelectedId(r.id)}>
                  {p ? <DotChart stages={planStages(p)} mode="field" cols={11} rows={4} label="" /> : <span style={{ width: 99, flexShrink: 0 }} />}
                  <span className="lib-row-text">
                    <span className="lib-row-name one-line">{recipeName(r)}</span>
                    <span className="label one-line">{[recipeCoffee(r), recipeGrind(r) ? `GRIND ${recipeGrind(r)}` : ''].filter(Boolean).join(' · ').toUpperCase() || (r.profileTitle ?? '').toUpperCase()}</span>
                  </span>
                </button>
              </li>
            )
          })}
          {!ids.length && <li className="lib-empty" data-testid="lib-empty">{emptyText(tab, query, hasDye2)}</li>}
          {!ids.length && !query && tab === 'recipes' && hasDye2 && <li><button type="button" className="chip beans-empty-action" onClick={onOpenHistory}>OPEN HISTORY</button></li>}
        </ul>

        {bean && <BeanDetail bean={bean} bags={liveBags(allBags, bean.id)} nextBagId={nextBag?.id} busy={busy} now={now}
          onEdit={() => setForm({ kind: 'bean', bean })}
          onDelete={() => setConfirm({ kind: 'bean', bean })}
          onAddBag={() => setForm({ kind: 'bag', bean, bag: null })}
          onEditBag={(bag) => setForm({ kind: 'bag', bean, bag })}
          onFinishBag={(bag) => run(() => updateBag(bag.id, { archived: true }), 'Bag marked finished')}
          onUse={(bag) => run(() => chooseBag(bean, bag), `${bean.name} is set for the next shot`)} />}
        {grinder && <GrinderDetail grinder={grinder} inUse={grinder.id === nextGrinderId} busy={busy}
          onEdit={() => setForm({ kind: 'grinder', grinder })}
          onDelete={() => setConfirm({ kind: 'grinder', grinder })}
          onUse={() => run(() => chooseGrinder(grinder), `${grinder.model} is set for the next shot`)} />}
        {recipe && <RecipeDetail recipe={recipe} units={prefs.units} busy={busy}
          onEdit={() => editInDye2(recipe)}
          onUse={() => run(async () => { await applyRecipe(recipe); onBack() }, `${recipeName(recipe)} is set for the next shot`)} />}
        {!bean && !grinder && !recipe && <section className="lib-detail hist-detail-empty" aria-label="Details" />}
      </div>

      {form?.kind === 'bean' && <BeanForm bean={form.bean} onClose={(saved) => { setForm(null); if (saved) { setSelectedId(saved.id); toast(form.bean ? 'Saved' : 'Coffee added') } }} />}
      {form?.kind === 'bag' && <BagForm bean={form.bean} bag={form.bag} onClose={(saved) => { setForm(null); if (saved) toast(form.bag ? 'Saved' : 'Bag added') }} />}
      {form?.kind === 'grinder' && <GrinderForm grinder={form.grinder} onClose={(saved) => { setForm(null); if (saved) { setSelectedId(saved.id); toast(form.grinder ? 'Saved' : 'Grinder added') } }} />}
      {confirm?.kind === 'bean' && (
        <ConfirmDialog eyebrow="DELETE COFFEE" title={`Delete “${confirm.bean.name}”?`}
          body={<>Its bags go too. Shots you’ve pulled with it keep its name.</>}
          holdLabel="HOLD TO DELETE" onCancel={() => setConfirm(null)}
          onConfirm={() => { const b = confirm.bean; setConfirm(null); setSelectedId(null); void run(() => deleteBean(b.id).catch(cantDelete), 'Deleted') }} />
      )}
      {confirm?.kind === 'grinder' && (
        <ConfirmDialog eyebrow="DELETE GRINDER" title={`Delete “${confirm.grinder.model}”?`}
          body={<>Shots you’ve pulled with it keep its name.</>}
          holdLabel="HOLD TO DELETE" onCancel={() => setConfirm(null)}
          onConfirm={() => { const g = confirm.grinder; setConfirm(null); setSelectedId(null); void run(() => deleteGrinder(g.id).catch(cantDelete), 'Deleted') }} />
      )}
      {picking && <ShotPicker onClose={(savedId) => { setPicking(false); if (savedId) setSelectedId(savedId) }} />}
    </div>
  )
}

// Decaid refuses to delete a record shots still point at; say so plainly rather than show its error.
const cantDelete = (error: unknown): never => {
  throw new Error(error instanceof Error && /constraint|foreign|referenc/i.test(error.message) ? 'Shots still use it, so Decaid keeps it.' : error instanceof Error ? error.message : "Couldn't delete.")
}

function emptyText(tab: BeansTab, query: string, hasDye2: boolean) {
  if (query) return `Nothing matches “${query}”.`
  if (tab === 'beans') return 'No coffees yet. Add one with New.'
  if (tab === 'grinders') return 'No grinders yet. Add one with New.'
  if (!hasDye2) return 'Recipes are kept by the DYE2 plugin. Turn it on in Settings → System → Plugins.'
  return 'No recipes yet. Open History, pick a shot you liked and save it as a recipe.'
}

function Facts({ items }: { items: [string, string | null | undefined][] }) {
  const shown = items.filter(([, v]) => v)
  if (!shown.length) return null
  return (
    <div className="beans-facts">
      {shown.map(([label, v]) => <div key={label}><span className="label">{label}</span><span className="beans-fact">{v}</span></div>)}
    </div>
  )
}

interface BeanDetailProps { bean: Bean; bags: Bag[]; nextBagId?: string; busy: boolean; now: Date; onEdit: () => void; onDelete: () => void; onAddBag: () => void; onEditBag: (bag: Bag) => void; onFinishBag: (bag: Bag) => void; onUse: (bag: Bag | null) => void }

function BeanDetail({ bean, bags: live, nextBagId, busy, now, onEdit, onDelete, onAddBag, onEditBag, onFinishBag, onUse }: BeanDetailProps) {
  const inUse = live.some((b) => b.id === nextBagId)
  const alt = bean.altitude?.length ? (bean.altitude[0] === bean.altitude[bean.altitude.length - 1] ? `${bean.altitude[0]} m` : `${bean.altitude[0]}–${bean.altitude[1]} m`) : null
  return (
    <article className="lib-detail" data-testid="bean-detail">
      <div className="lib-detail-scroll">
        <div className="lib-detail-head">
          <span className="label">{[bean.roaster, bean.decaf ? 'DECAF' : ''].filter(Boolean).join(' · ').toUpperCase()}{inUse ? ' · NEXT SHOT' : ''}</span>
          <span className="lib-detail-title" title={bean.name}>{bean.name}</span>
        </div>
        <Facts items={[['ORIGIN', [bean.country, bean.region].filter(Boolean).join(', ')], ['PRODUCER', bean.producer], ['PROCESS', bean.processing], ['VARIETY', bean.variety?.join(', ')], ['ALTITUDE', alt]]} />
        {bean.notes ? <span className="lib-detail-notes">{bean.notes}</span> : null}
        <div className="beans-bags">
          <span className="label">BAGS · {live.length}</span>
          {live.map((bag) => (
            <div key={bag.id} className="beans-bag" data-testid="bag-row">
              <span className="beans-bag-text">
                <span className="beans-bag-name">{bagLabel(bag, now)}{bag.id === nextBagId ? <span style={{ color: 'var(--brown)' }}> · NEXT SHOT</span> : null}</span>
                {bag.roastLevel || bag.notes ? <span className="hist-sub">{[bag.roastLevel, bag.notes].filter(Boolean).join(' · ')}</span> : null}
              </span>
              <span className="chips" style={{ flexWrap: 'nowrap' }}>
                {live.length > 1 && bag.id !== nextBagId && <button type="button" className="chip" disabled={busy} onClick={() => onUse(bag)}>USE</button>}
                <button type="button" className="chip" disabled={busy} onClick={() => onEditBag(bag)}>EDIT</button>
                <button type="button" className="chip" disabled={busy} onClick={() => onFinishBag(bag)}>FINISHED</button>
              </span>
            </div>
          ))}
          <button type="button" className="chip beans-add-bag" disabled={busy} onClick={onAddBag}><DotIcon glyph="plus" />ADD A BAG</button>
        </div>
      </div>
      <div className="lib-actions">
        <div className="chips">
          <button type="button" className="chip" disabled={busy} onClick={onEdit}>EDIT</button>
          <button type="button" className="chip" disabled={busy} onClick={onDelete}>DELETE</button>
        </div>
        <button type="button" className="primary lib-select" disabled={busy || inUse} onClick={() => onUse(live[0] ?? null)}>
          <DotIcon glyph="check" color="var(--on-primary)" primary />{inUse ? 'IN USE' : 'USE'}
        </button>
      </div>
    </article>
  )
}

function GrinderDetail({ grinder, inUse, busy, onEdit, onDelete, onUse }: { grinder: Grinder; inUse: boolean; busy: boolean; onEdit: () => void; onDelete: () => void; onUse: () => void }) {
  return (
    <article className="lib-detail" data-testid="grinder-detail">
      <div className="lib-detail-scroll">
        <div className="lib-detail-head">
          <span className="label">GRINDER{inUse ? ' · NEXT SHOT' : ''}</span>
          <span className="lib-detail-title" title={grinder.model}>{grinder.model}</span>
        </div>
        <Facts items={[['BURRS', grinder.burrs], ['BURR SIZE', grinder.burrSize != null ? `${grinder.burrSize} mm` : null], ['TYPE', grinder.burrType]]} />
        {grinder.notes ? <span className="lib-detail-notes">{grinder.notes}</span> : null}
      </div>
      <div className="lib-actions">
        <div className="chips">
          <button type="button" className="chip" disabled={busy} onClick={onEdit}>EDIT</button>
          <button type="button" className="chip" disabled={busy} onClick={onDelete}>DELETE</button>
        </div>
        <button type="button" className="primary lib-select" disabled={busy || inUse} onClick={onUse}>
          <DotIcon glyph="check" color="var(--on-primary)" primary />{inUse ? 'IN USE' : 'USE'}
        </button>
      </div>
    </article>
  )
}

function RecipeDetail({ recipe, units, busy, onEdit, onUse }: { recipe: Recipe; units: 'c' | 'f'; busy: boolean; onEdit: () => void; onUse: () => void }) {
  return (
    <article className="lib-detail" data-testid="recipe-detail">
      <RecipeView recipe={recipe} units={units} />
      <div className="lib-actions">
        <div className="chips">
          <button type="button" className="chip" disabled={busy} onClick={onEdit}>EDIT IN DYE2</button>
        </div>
        <button type="button" className="primary lib-select" disabled={busy || !recipe.workflow} onClick={onUse}>
          <DotIcon glyph="check" color="var(--on-primary)" primary />USE
        </button>
      </div>
    </article>
  )
}
