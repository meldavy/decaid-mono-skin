// Decaid reports the tank as the water height the DE1's sensor reads, in mm (the refill threshold too). Mono shows it
// as a percentage of the tank's volume: height → millilitres by the DE1 app's calibration table (the one Streamline
// uses for its ml readout), then millilitres as a share of the table's top.

// Millilitres at each whole mm of sensor height (index = mm). Above the table counts as full.
const MM_TO_ML = [
  0, 16, 43, 70, 97, 124, 151, 179, 206, 233,
  261, 288, 316, 343, 371, 398, 426, 453, 481, 509,
  537, 564, 592, 620, 648, 676, 704, 732, 760, 788,
  816, 844, 872, 900, 929, 957, 985, 1013, 1042, 1070,
  1104, 1138, 1172, 1207, 1242, 1277, 1312, 1347, 1382, 1417,
  1453, 1488, 1523, 1559, 1594, 1630, 1665, 1701, 1736, 1772,
  1808, 1843, 1879, 1915, 1951, 1986, 2022, 2058,
]
const TANK_FULL_ML = MM_TO_ML[MM_TO_ML.length - 1]

const millilitres = (mm: number) => MM_TO_ML[Math.min(MM_TO_ML.length - 1, Math.max(0, Math.floor(mm)))]

export const tankPercent = (mm: number | undefined) =>
  mm === undefined || !Number.isFinite(mm) ? undefined : Math.round((millilitres(mm) / TANK_FULL_ML) * 100)

// The sensor height (whole mm, what the machine takes) closest to a percentage of the tank.
export function tankMmForPercent(percent: number) {
  const ml = (percent / 100) * TANK_FULL_ML
  let best = 0
  MM_TO_ML.forEach((v, mm) => { if (Math.abs(v - ml) < Math.abs(MM_TO_ML[best] - ml)) best = mm })
  return best
}

// The refill message follows the machine's own "needs water" state (the one where it won't start a shot), as Streamline
// does. Never the level against the threshold: the sensor jitters around it, mid-shot included.
export const needsRefill = (machineState: string | undefined) => machineState === 'needsWater'
