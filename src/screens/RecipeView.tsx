import { useMemo } from 'react'
import { dayLabel } from '../domain/history'
import { planStages } from '../domain/profile'
import { bags, roastAge } from '../state/coffee'
import { useResource } from '../state/resource'
import { roastedLabel } from '../ui/coffeeFormat'
import { recipeCoffee, recipeGrind, recipeGrinder, recipeName, recipeProfile, type Recipe } from '../state/recipes'
import { DISPLAY_PITCH, DotChart } from '../ui/DotChart'
import { chartCols } from '../ui/fit'
import { fixed, NONE, tempLabel, toUnit } from '../ui/format'
import { fitLegend } from '../ui/legend'
import { useShort } from '../ui/useShort'
import { useSize } from '../ui/useSize'
import { slotNo } from './ProfileDetail'
import './library.css'
import './history.css' // hist-sub, hist-settings

// A recipe's details — name, what it brews, its plan with every stage, its numbers, its coffee and grinder. Only the
// content: the Beans panel and the favourites pop-up put it in their own frame with their own buttons, as with
// ProfileDetail. `tall`: a taller chart, for the pop-up.
export function RecipeView({ recipe, units, slot = -1, tall = false }: { recipe: Recipe; units: 'c' | 'f'; slot?: number; tall?: boolean }) {
  const p = recipeProfile(recipe)
  const stages = useMemo(() => (p ? planStages(p) : []), [p])
  const [chartRef, { width }] = useSize<HTMLDivElement>()
  const short = useShort()
  const legendCols = width > 0 && width < 520 ? 2 : 3
  const legend = fitLegend(stages, legendCols, short ? 2 : 999)
  const dv = recipe.dashboardVariables ?? {}
  const ctx = recipe.workflow?.context ?? {}
  const temp = dv.brewC ?? p?.steps[0]?.temperature
  const dose = dv.dose ?? (ctx.targetDoseWeight as number | undefined)
  const drink = dv.drink ?? (ctx.targetYield as number | undefined)
  const roaster = recipe.beanRoaster ?? (typeof ctx.coffeeRoaster === 'string' ? ctx.coffeeRoaster : undefined)
  const coffee = [roaster, recipeCoffee(recipe)].filter(Boolean).join(', ')
  const saved = recipe.capturedAt ? new Date(recipe.capturedAt) : null
  const bag = (useResource(bags).value ?? []).find((b) => b.id === ((ctx.beanBatchId as string | undefined) ?? (recipe as { beanBatchId?: string }).beanBatchId))
  const age = roastAge(bag?.roastDate, new Date())
  const roast = bag ? [roastedLabel(bag.roastDate, new Date()), age !== undefined ? `${age} D` : ''].filter(Boolean).join(' · ') : undefined
  const machine = machineSettings(recipe, units)
  const facts: [string, string | undefined][] = [
    ['COFFEE', coffee || undefined],
    ['BAG', roast],
    ['GRINDER', recipeGrinder(recipe)],
    ['PROFILE', recipe.profileTitle || p?.title],
    ['SAVED', saved && !Number.isNaN(saved.getTime()) ? dayLabel(saved, new Date()) : undefined],
  ]
  return (
    <div className="lib-detail-scroll" data-testid="recipe-view">
      <div className="lib-detail-head">
        <span className="label">RECIPE{slot >= 0 ? <span style={{ color: 'var(--brown)' }}> · FAVOURITE {slotNo(slot)}</span> : null}</span>
        <span className="lib-detail-title" title={recipeName(recipe)}>{recipeName(recipe)}</span>
        {(coffee || recipeGrinder(recipe)) && <span className="hist-sub">{[coffee, recipeGrinder(recipe)].filter(Boolean).join(' · ')}</span>}
      </div>
      {p && (
        <div className="lib-detail-chart" ref={chartRef}>
          <DotChart stages={stages} cols={chartCols(width, DISPLAY_PITCH)} rows={(short ? 9 : 13) + (tall ? 4 : 0)} axis rail label={`${p.title}: pressure and flow by stage`} />
          <div className={`legend${legendCols === 3 ? ' legend-3' : ''} label`}>
            {legend.items.map((it) => (
              <span key={it.no} className="legend-item"><span className="legend-dot" style={{ background: it.tone ? 'var(--line-mid)' : 'var(--taupe)' }} /><span>{it.no}</span><span className="legend-name one-line">{it.name}</span><span>{it.dur}</span></span>
            ))}
            {legend.more > 0 && <span className="legend-item">+{legend.more} MORE</span>}
          </div>
        </div>
      )}
      <div className="lib-stats">
        <div><span className="label">TEMP {tempLabel(units)}</span><span className="lib-stat">{temp == null ? NONE : fixed(toUnit(temp, units), 0)}</span></div>
        <div><span className="label">DOSE G</span><span className="lib-stat">{fixed(dose, 1)}</span></div>
        <div><span className="label">YIELD G</span><span className="lib-stat">{fixed(drink, 1)}</span></div>
        <div><span className="label">GRIND</span><span className="lib-stat one-line">{recipeGrind(recipe) ?? NONE}</span></div>
      </div>
      {facts.some(([, v]) => v) && (
        <div className="hist-settings">
          <div className="hist-settings-grid">
            {facts.filter(([, v]) => v).map(([label, v]) => (
              <div key={label} className={label === 'COFFEE' || label === 'PROFILE' ? 'wide' : undefined}><span className="label">{label}</span><span className="hist-setting">{v}</span></div>
            ))}
          </div>
        </div>
      )}
      {machine.length > 0 && (
        <div className="hist-settings" data-testid="recipe-machine">
          <div className="hist-settings-grid">
            {machine.map(([label, v]) => <div key={label}><span className="label">{label}</span><span className="hist-setting">{v}</span></div>)}
          </div>
        </div>
      )}
    </div>
  )
}

// Steam, hot water and flush as the recipe sets them (Decaid's workflow shapes; DYE2 keeps the same in its
// dashboard variables). Steam below 135 °C is steam off, as DYE2 and Decaid treat it.
type Machine = { targetTemperature?: number; duration?: number; flow?: number; volume?: number }
function machineSettings(recipe: Recipe, units: 'c' | 'f'): [string, string][] {
  const w = recipe.workflow ?? {}
  const steam = w.steamSettings as Machine | undefined
  const water = w.hotWaterData as Machine | undefined
  const flush = w.rinseData as Machine | undefined
  const t = (c?: number) => (c == null ? undefined : `${fixed(toUnit(c, units), 0)}°`)
  const n = (v: number | undefined, unit: string, d = 0) => (v == null ? undefined : `${fixed(v, d)} ${unit}`)
  const out: [string, string | undefined][] = [
    ['STEAM', steam ? (steam.targetTemperature != null && steam.targetTemperature < 135 ? 'Off' : [t(steam.targetTemperature), n(steam.duration, 's'), n(steam.flow, 'ml/s', 1)].filter(Boolean).join(' · ')) : undefined],
    ['HOT WATER', water ? [t(water.targetTemperature), n(water.volume, 'ml'), n(water.flow, 'ml/s', 1)].filter(Boolean).join(' · ') : undefined],
    ['FLUSH', flush ? [n(flush.duration, 's'), t(flush.targetTemperature), n(flush.flow, 'ml/s', 1)].filter(Boolean).join(' · ') : undefined],
  ]
  return out.filter((x): x is [string, string] => !!x[1])
}
