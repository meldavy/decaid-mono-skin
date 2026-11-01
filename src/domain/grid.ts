// Everything Mono draws as dots sits on one grid. These helpers snap values onto it.

export interface GridSpec {
  cols: number
  rows: number
  max: number // value shown at the top row
}

// Row index for a value: 0 is the bottom row, rows-1 the top. Out-of-range values clamp.
export function rowFor(value: number, { rows, max }: Pick<GridSpec, 'rows' | 'max'>): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(rows - 1, Math.round((value / max) * (rows - 1))))
}

// Column index for a time on an axis of `duration` seconds.
export function colFor(t: number, duration: number, cols: number): number {
  if (duration <= 0) return 0
  return Math.max(0, Math.min(cols - 1, Math.floor((t / duration) * cols)))
}

// Rows to light between two neighbouring columns so a steep change reads as a continuous line.
export function bridge(fromRow: number, toRow: number): number[] {
  const rows: number[] = []
  for (let r = Math.min(fromRow, toRow) + 1; r < Math.max(fromRow, toRow); r++) rows.push(r)
  return rows
}

// A column's span of rows: one dot when lo = hi, a short vertical run when the column holds a rise or a fall.
// `last` is the row of the column's latest sample, what a following empty column carries on from.
export interface Cell { lo: number; hi: number; last: number }

// Samples (t, value) → each column's span, from its lowest row to its highest, so a peak or a dip reaches its true
// height however the column boundaries move as the chart compacts. A spike narrower than a column — a rise and a
// fall either side of one tip, each shorter than a column — is drawn whole in the tip's column, so it stays one dot
// wide instead of flickering between one and two columns. Slow ramps and plain steps keep their own columns.
// Columns with no sample are null.
export function quantize(samples: { t: number; v: number }[], duration: number, spec: GridSpec): (Cell | null)[] {
  const pts = samples.filter((s) => Number.isFinite(s.v)).map((s) => ({ row: rowFor(s.v, spec), col: colFor(s.t, duration, spec.cols), t: s.t }))
  // Rises and falls, in rows (a wobble within one row is no movement): [first index, last index that moved].
  const runs: { a: number; b: number }[] = []
  let a = 0
  let moved = 0
  let dir = 0
  for (let j = 1; j < pts.length; j++) {
    const d = Math.sign(pts[j].row - pts[j - 1].row)
    if (d === 0) { if (dir === 0) a = j; continue }
    if (dir !== 0 && d !== dir) { runs.push({ a, b: moved }); a = j - 1 }
    dir = d
    moved = j
  }
  if (dir !== 0) runs.push({ a, b: moved })
  const width = duration / spec.cols
  const short = (k: number) => k >= 0 && k < runs.length && pts[runs[k].b].t - pts[runs[k].a].t < width
  // A rise then a fall (or a fall then a rise), each shorter than a column, around a top (or bottom) that is too:
  // the whole spike goes into the column of its tip.
  for (let k = 0; k + 1 < runs.length; k++) {
    const [up, down] = [runs[k], runs[k + 1]]
    if (!short(k) || !short(k + 1) || pts[down.a].t - pts[up.b].t >= width) continue
    for (let i = up.a; i <= down.b; i++) pts[i].col = pts[up.b].col
  }
  const cells: (Cell | null)[] = new Array(spec.cols).fill(null)
  for (const p of pts) {
    const cell = cells[p.col]
    cells[p.col] = cell ? { lo: Math.min(cell.lo, p.row), hi: Math.max(cell.hi, p.row), last: p.row } : { lo: p.row, hi: p.row, last: p.row }
  }
  return cells
}

// Rows to light between two neighbouring columns' spans so the line stays continuous (none if they touch).
export function join(prev: Cell, next: Cell): number[] {
  if (next.lo > prev.hi) return bridge(prev.hi, next.lo)
  if (next.hi < prev.lo) return bridge(next.hi, prev.lo)
  return []
}
