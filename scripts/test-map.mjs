#!/usr/bin/env node
// Checks docs/CONTROLS.md against the tests.
//   node scripts/test-map.mjs                 report coverage for every area
//   node scripts/test-map.mjs HOME SHEET      fail unless every HOME-* and SHEET-* ID is covered
//   node scripts/test-map.mjs --all           fail unless every ID is covered
// An ID is covered when every level it lists is satisfied: U by a unit test (src/), S/D/B/I by an end-to-end
// test (tests/e2e/), M by an entry in docs/MANUAL-LOG.md. A test claims an ID by starting its title with it.
// Always fails if a test names an ID that isn't in CONTROLS.md.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const doc = readFileSync(join(root, 'docs/CONTROLS.md'), 'utf8')
const rows = [...doc.matchAll(/^\| ([A-Z]+-\d{2}) \| (.+?) \| ([A-Z+]+) \|$/gm)]
const scenarios = new Map(rows.map(([, id, text, level]) => [id, { text, level }]))

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(spec|test)\.tsx?$/.test(name)) files.push(path)
  }
}
walk(join(root, 'src'))
walk(join(root, 'tests'))

const claims = new Map() // id → Set of 'unit' | 'e2e' | 'manual'
const claim = (id, kind) => claims.set(id, (claims.get(id) ?? new Set()).add(kind))
const unknown = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const [, title] of source.matchAll(/\b(?:test|it|describe)(?:\.\w+)?\(\s*['"`]([^'"`]+)['"`]/g)) {
    const ids = title.match(/^((?:[A-Z]+-\d{2}[ ,]*)+)/)?.[1].match(/[A-Z]+-\d{2}/g) ?? []
    for (const id of ids) {
      if (!scenarios.has(id)) unknown.push(`${id} in ${file.replace(root, '')}`)
      else claim(id, file.includes('/tests/e2e/') ? 'e2e' : 'unit')
    }
  }
}
const manualLog = existsSync(join(root, 'docs/MANUAL-LOG.md')) ? readFileSync(join(root, 'docs/MANUAL-LOG.md'), 'utf8') : ''
for (const [id, { level }] of scenarios) {
  if (new RegExp(`\\b${id}\\b`).test(manualLog)) claim(id, 'manual')
}
const needs = (level) => [...new Set(level.split('+').map((l) => (l === 'U' ? 'unit' : l === 'M' ? 'manual' : 'e2e')))]
const covered = new Set([...scenarios].filter(([id, { level }]) => needs(level).every((k) => claims.get(id)?.has(k))).map(([id]) => id))

const args = process.argv.slice(2)
const required = args.includes('--all') ? null : new Set(args)
const areas = [...new Set([...scenarios.keys()].map((id) => id.split('-')[0]))]
let failed = unknown.length > 0
for (const area of areas) {
  const ids = [...scenarios.keys()].filter((id) => id.startsWith(area + '-'))
  const missing = ids.filter((id) => !covered.has(id))
  const enforce = required === null || required.has(area)
  console.log(`${enforce ? '*' : ' '} ${area.padEnd(6)} ${String(ids.length - missing.length).padStart(3)}/${ids.length}`)
  if (enforce && missing.length) {
    failed = true
    for (const id of missing) {
      const have = [...(claims.get(id) ?? [])].join('+') || 'nothing'
      console.log(`    missing ${id} [${scenarios.get(id).level}, has ${have}]  ${scenarios.get(id).text}`)
    }
  }
}
for (const entry of unknown) console.log(`unknown ID ${entry}`)
const total = scenarios.size
console.log(`\n${covered.size}/${total} scenarios covered`)
process.exit(failed ? 1 : 0)
