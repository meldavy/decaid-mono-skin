import { planStages, plannedDuration, type ProfileRecord } from '../domain/profile'
import { DISPLAY_PITCH, DotChart } from '../ui/DotChart'
import { chartCols } from '../ui/fit'
import { fixed, NONE, tempLabel, toUnit } from '../ui/format'
import { fitLegend } from '../ui/legend'
import { useShort } from '../ui/useShort'
import { useSize } from '../ui/useSize'
import './library.css' // the detail layout it shares with History's shot detail

export const slotNo = (i: number) => String(i + 1).padStart(2, '0')
export const kindLabel = (r: ProfileRecord) => `${r.isDefault ? 'BUILT-IN' : 'MINE'}${r.profile.beverage_type ? ` · ${String(r.profile.beverage_type).toUpperCase()}` : ''}`

// A profile's details — what it is, its plan with every stage, its numbers and its notes. Only the content: the
// Library panel and the pop-ups put it in their own container, with their own buttons. It scrolls by itself.
// `tall`: a taller chart, for the pop-ups, which have the height for it (rows step by 4 so the bar labels stay on rows).
export function ProfileDetail({ record, slot, onMachine, units, tall = false }: { record: ProfileRecord; slot: number; onMachine: boolean; units: 'c' | 'f'; tall?: boolean }) {
  const p = record.profile
  const stages = planStages(p)
  const [chartRef, { width: chartWidth }] = useSize<HTMLDivElement>()
  const short = useShort()
  // Every stage (the content scrolls); on a short screen two lines, so the numbers below stay in view.
  const legendCols = chartWidth > 0 && chartWidth < 520 ? 2 : 3
  const legend = fitLegend(stages, legendCols, short ? 2 : 999)
  const temp = p.steps[0]?.temperature
  return (
    <div className="lib-detail-scroll" data-testid="detail-scroll">
      <div className="lib-detail-head">
        <span className="label">{kindLabel(record)}{slot >= 0 ? <span style={{ color: 'var(--brown)' }}> · FAVOURITE {slotNo(slot)}</span> : null}{onMachine ? ' · ON THE MACHINE' : ''}</span>
        <span className="lib-detail-title" title={p.title}>{p.title || 'Untitled'}</span>
      </div>
      <div className="lib-detail-chart" ref={chartRef}>
        <DotChart stages={stages} cols={chartCols(chartWidth, DISPLAY_PITCH)} rows={(short ? 9 : 13) + (tall ? 4 : 0)} axis rail label={`${p.title}: pressure and flow by stage`} />
        <div className={`legend${legendCols === 3 ? ' legend-3' : ''} label`}>
          {legend.items.map((it) => (
            <span key={it.no} className="legend-item"><span className="legend-dot" style={{ background: it.tone ? '#D9C8AE' : 'var(--taupe)' }} /><span>{it.no}</span><span className="legend-name one-line">{it.name}</span><span>{it.dur}</span></span>
          ))}
          {legend.more > 0 && <span className="legend-item">+{legend.more} MORE</span>}
        </div>
      </div>
      <div className="lib-stats">
        <div><span className="label">TEMP {tempLabel(units)}</span><span className="lib-stat">{temp === undefined ? NONE : fixed(toUnit(temp, units), 0)}</span></div>
        <div><span className="label">YIELD G</span><span className="lib-stat">{p.target_weight ? fixed(p.target_weight, 1) : NONE}</span></div>
        <div><span className="label">STAGES</span><span className="lib-stat">{p.steps.length}</span></div>
        <div><span className="label">LENGTH S</span><span className="lib-stat">{Math.round(plannedDuration(stages))}</span></div>
      </div>
      {p.notes ? <span className="lib-detail-notes" data-testid="lib-notes">{String(p.notes)}</span> : null}
    </div>
  )
}
