import { AXIS_COLS } from './DotChart'

// Grid dimensions that fill a box: whole dots at `pitch`, axis columns and the unit row included, and a row
// count whose axis labels (every 3 bar of 12) land on whole rows: (rows - 1) divisible by 4.
export function fitGrid(width: number, height: number, pitch: number, { axis = false, extraRows = 0, anyRows = false } = {}) {
  const cols = Math.max(4, Math.floor(width / pitch) - (axis ? AXIS_COLS : 0))
  const maxRows = Math.max(5, Math.floor(height / pitch) - extraRows)
  // Normally a row count that puts 0 / 3 / 6 / 9 / 12 exactly on rows; `anyRows` fills every row the space allows.
  const rows = anyRows ? maxRows : maxRows - ((maxRows - 1) % 4)
  return { cols, rows }
}

// Whole dots across a width at `pitch`.
export const fitDots = (width: number, pitch: number) => Math.max(1, Math.floor(width / pitch))

// Chart columns for a detail panel: fill the measured width (12 until it's been measured).
export const chartCols = (width: number, pitch: number, axis = true) =>
  Math.max(12, Math.floor(width / pitch) - (axis ? AXIS_COLS : 0))
