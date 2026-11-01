import type { PlannedStage } from '../domain/profile'

// Stage legend under a chart: "01 Prefill 5 S", in equal columns. Names are freeform: they truncate to the
// column width (CSS ellipsis). When there are more stages than cells, the last cell becomes "+N MORE".

export interface LegendItem { no: string; name: string; dur: string; tone: number }
export interface Legend { items: LegendItem[]; more: number }

export const legendName = (name: string, i: number) => name.trim() || `Stage ${i + 1}`

export function fitLegend(stages: PlannedStage[], columns: number, lines: number): Legend {
  const all = stages.map((s, i) => ({ no: String(i + 1).padStart(2, '0'), name: legendName(s.name, i), dur: `${Math.round(s.t1 - s.t0)} S`, tone: i % 2 }))
  const cells = columns * lines
  if (all.length <= cells) return { items: all, more: 0 }
  return { items: all.slice(0, cells - 1), more: all.length - (cells - 1) }
}
