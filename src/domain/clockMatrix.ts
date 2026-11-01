// The sleep clock: 5 × 7 digits drawn as lit dots on a full-screen dot field. Each digit dot is `scale` × `scale`
// field dots, so the clock is made of the same dots as the field around it.

export const DIGITS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '#', '.', '#', '.', '.'],
}

export interface ClockLayout {
  cols: number
  rows: number
  lit: Set<string> // "row,col"
  top: number // first lit row
  bottom: number // last lit row
}

// Lays `text` out in the middle of a cols × rows field.
export function clockLayout(text: string, cols: number, rows: number, scale = 2, gap = 2): ClockLayout {
  const glyphs = text.split('').map((ch) => DIGITS[ch] ?? DIGITS['0'])
  const width = glyphs.reduce((w, g) => w + g[0].length * scale + gap, -gap)
  const top = Math.floor((rows - 7 * scale) / 2)
  let col = Math.floor((cols - width) / 2)
  const lit = new Set<string>()
  for (const g of glyphs) {
    g.forEach((line, r) => line.split('').forEach((p, c) => {
      if (p !== '#') return
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) lit.add(`${top + r * scale + dy},${col + c * scale + dx}`)
    }))
    col += g[0].length * scale + gap
  }
  return { cols, rows, lit, top, bottom: top + 7 * scale - 1 }
}
