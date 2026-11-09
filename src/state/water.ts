// Decaid reports the tank as the water height the DE1's sensor reads, in mm (the refill threshold too). Mono shows it
// as a percentage, the way the DE1 app reads the sensor:
// - 5 mm is added first: the sensor sits a few mm above the water uptake point (de1app water_level_mm_correction).
// - Height → millilitres by the DE1 app's calibration table (the one Streamline uses for its ml readout).
// - Full is 50 mm, the top of the DE1 app's tank gauges (water_level_sensor_max), not the top of the table: that is
//   the tank's whole geometry, which the sensor never reaches, so a filled tank used to read about 55%.
// Anything above full shows 100%, never more.

// Millilitres at each whole mm of corrected height (index = mm).
const MM_TO_ML = [
  0, 16, 43, 70, 97, 124, 151, 179, 206, 233,
  261, 288, 316, 343, 371, 398, 426, 453, 481, 509,
  537, 564, 592, 620, 648, 676, 704, 732, 760, 788,
  816, 844, 872, 900, 929, 957, 985, 1013, 1042, 1070,
  1104, 1138, 1172, 1207, 1242, 1277, 1312, 1347, 1382, 1417,
  1453, 1488, 1523, 1559, 1594, 1630, 1665, 1701, 1736, 1772,
  1808, 1843, 1879, 1915, 1951, 1986, 2022, 2058,
]
export const SENSOR_CORRECTION_MM = 5
export const FULL_MM = 50 // corrected height
const FULL_ML = MM_TO_ML[FULL_MM]

const millilitres = (corrected: number) => MM_TO_ML[Math.min(MM_TO_ML.length - 1, Math.max(0, Math.floor(corrected)))]

// Sensor mm (as Decaid reports it) → percent of a full tank, 0–100.
export const tankPercent = (mm: number | undefined) =>
  mm === undefined || !Number.isFinite(mm) ? undefined : Math.min(100, Math.round((millilitres(mm + SENSOR_CORRECTION_MM) / FULL_ML) * 100))

// The sensor height (whole mm, as the machine takes it) closest to a percentage of a full tank.
export function tankMmForPercent(percent: number) {
  const ml = (Math.min(100, Math.max(0, percent)) / 100) * FULL_ML
  let best = 0
  for (let mm = 0; mm <= FULL_MM; mm++) if (Math.abs(MM_TO_ML[mm] - ml) < Math.abs(MM_TO_ML[best] - ml)) best = mm
  return Math.max(0, best - SENSOR_CORRECTION_MM)
}

// The refill message follows the machine's own "needs water" state (the one where it won't start a shot), as Streamline
// does. Never the level against the threshold: the sensor jitters around it, mid-shot included.
export const needsRefill = (machineState: string | undefined) => machineState === 'needsWater'
