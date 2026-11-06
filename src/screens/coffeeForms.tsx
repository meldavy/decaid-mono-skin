import { createBag, createBean, createGrinder, updateBag, updateBean, updateGrinder, type Bag, type Bean, type Grinder } from '../state/coffee'
import { FormSheet, type Field } from '../sheets/FormSheet'

// The bean, bag and grinder forms. Strings in, Decaid records out: blank optional fields are sent as null, so
// clearing a field clears it in Decaid too.

const text = (v: string | undefined) => (v ?? '').trim() || null
const num = (v: string | undefined) => {
  const t = (v ?? '').trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined // undefined: not a number
}
// A date input gives YYYY-MM-DD; Decaid keeps date-times. Noon UTC, so the day survives any time zone.
const toDateTime = (v: string | undefined) => ((v ?? '').trim() ? `${v!.trim()}T12:00:00.000Z` : null)
const toDateInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : '')

const BEAN_FIELDS: Field[] = [
  { key: 'roaster', label: 'ROASTER', placeholder: 'e.g. Square Mile' },
  { key: 'name', label: 'COFFEE', span: 2, placeholder: 'e.g. Red Brick' },
  { key: 'country', label: 'COUNTRY · OPTIONAL' },
  { key: 'region', label: 'REGION · OPTIONAL' },
  { key: 'producer', label: 'PRODUCER · OPTIONAL' },
  { key: 'variety', label: 'VARIETY · OPTIONAL', placeholder: 'e.g. Bourbon, Typica' },
  { key: 'processing', label: 'PROCESS · OPTIONAL', placeholder: 'e.g. Washed' },
  { key: 'altitude', label: 'ALTITUDE M · OPTIONAL', placeholder: 'e.g. 1800–2000' },
  { key: 'notes', label: 'TASTING NOTES · OPTIONAL', kind: 'notes', span: 3 },
]

export function BeanForm({ bean, onClose }: { bean: Bean | null; onClose: (saved?: Bean) => void }) {
  const initial = {
    roaster: bean?.roaster ?? '', name: bean?.name ?? '', country: bean?.country ?? '', region: bean?.region ?? '',
    producer: bean?.producer ?? '', variety: (bean?.variety ?? []).join(', '), processing: bean?.processing ?? '',
    altitude: bean?.altitude?.length ? (bean.altitude[0] === bean.altitude[1] || bean.altitude.length === 1 ? String(bean.altitude[0]) : `${bean.altitude[0]}–${bean.altitude[1]}`) : '',
    notes: bean?.notes ?? '', decaf: bean?.decaf ? 'yes' : '',
  }
  return (
    <FormSheet
      title={bean ? 'Edit coffee' : 'New coffee'}
      fields={BEAN_FIELDS}
      initial={initial}
      extra={(v, set) => <button type="button" className="chip" aria-pressed={v.decaf === 'yes'} onClick={() => set('decaf', v.decaf === 'yes' ? '' : 'yes')}>DECAF</button>}
      onCancel={() => onClose()}
      onSave={async (v) => {
        if (!text(v.roaster) || !text(v.name)) return 'Roaster and coffee are both needed'
        const altitude = parseAltitude(v.altitude)
        if (altitude === undefined) return 'Altitude is a number, or a range like 1800–2000'
        const fields = {
          roaster: text(v.roaster)!, name: text(v.name)!, country: text(v.country), region: text(v.region), producer: text(v.producer),
          variety: text(v.variety) ? v.variety.split(',').map((x) => x.trim()).filter(Boolean) : null,
          processing: text(v.processing), altitude, notes: text(v.notes), decaf: v.decaf === 'yes',
        }
        if (bean) { await updateBean(bean.id, fields); onClose({ ...bean, ...fields }) } else onClose(await createBean(fields))
        return undefined
      }}
    />
  )
}

// "1800", "1800-2000", "1800–2000 m" → [min, max]. Blank → null; anything else → undefined.
export function parseAltitude(v: string | undefined): number[] | null | undefined {
  const t = (v ?? '').trim().replace(/\s*m$/i, '')
  if (!t) return null
  const parts = t.split(/\s*[-–—]\s*/).map(Number)
  if (parts.length > 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) return undefined
  return parts.length === 1 ? [parts[0], parts[0]] : [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])]
}

const BAG_FIELDS: Field[] = [
  { key: 'roastDate', label: 'ROASTED', kind: 'date' },
  { key: 'weight', label: 'WEIGHT G · OPTIONAL', kind: 'number', placeholder: 'e.g. 250' },
  { key: 'weightRemaining', label: 'LEFT G · OPTIONAL', kind: 'number' },
  { key: 'roastLevel', label: 'ROAST · OPTIONAL', span: 3, presets: ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'] },
  { key: 'notes', label: 'NOTES · OPTIONAL', kind: 'notes', span: 3 },
]

export function BagForm({ bean, bag, onClose }: { bean: Bean; bag: Bag | null; onClose: (saved?: Bag) => void }) {
  const fields = bag ? BAG_FIELDS : BAG_FIELDS.filter((f) => f.key !== 'weightRemaining') // a new bag starts full
  return (
    <FormSheet
      title={bag ? `Edit bag · ${bean.name}` : `New bag · ${bean.name}`}
      fields={fields}
      initial={{ roastDate: toDateInput(bag?.roastDate), weight: bag?.weight != null ? String(bag.weight) : '', weightRemaining: bag?.weightRemaining != null ? String(bag.weightRemaining) : '', roastLevel: bag?.roastLevel ?? '', notes: bag?.notes ?? '' }}
      onCancel={() => onClose()}
      onSave={async (v) => {
        const weight = num(v.weight)
        const left = num(v.weightRemaining)
        if (weight === undefined || left === undefined) return 'Weights are numbers of grams'
        const fields = { roastDate: toDateTime(v.roastDate), weight, roastLevel: text(v.roastLevel), notes: text(v.notes), ...(bag ? { weightRemaining: left } : {}) }
        if (bag) { await updateBag(bag.id, fields); onClose({ ...bag, ...fields }) } else onClose(await createBag(bean.id, fields))
        return undefined
      }}
    />
  )
}

const GRINDER_FIELDS: Field[] = [
  { key: 'model', label: 'GRINDER', span: 2, placeholder: 'e.g. Niche Zero' },
  { key: 'burrSize', label: 'BURR MM · OPTIONAL', kind: 'number', placeholder: 'e.g. 63' },
  { key: 'burrs', label: 'BURRS · OPTIONAL', span: 2, placeholder: 'e.g. SSP High Uniformity' },
  { key: 'burrType', label: 'TYPE · OPTIONAL', presets: ['Flat', 'Conical'] },
  { key: 'notes', label: 'NOTES · OPTIONAL', kind: 'notes', span: 3 },
]

export function GrinderForm({ grinder, onClose }: { grinder: Grinder | null; onClose: (saved?: Grinder) => void }) {
  return (
    <FormSheet
      title={grinder ? 'Edit grinder' : 'New grinder'}
      fields={GRINDER_FIELDS}
      initial={{ model: grinder?.model ?? '', burrs: grinder?.burrs ?? '', burrSize: grinder?.burrSize != null ? String(grinder.burrSize) : '', burrType: grinder?.burrType ?? '', notes: grinder?.notes ?? '' }}
      onCancel={() => onClose()}
      onSave={async (v) => {
        if (!text(v.model)) return 'The grinder needs a name'
        const burrSize = num(v.burrSize)
        if (burrSize === undefined) return 'Burr size is a number of millimetres'
        const fields = { model: text(v.model)!, burrs: text(v.burrs), burrSize, burrType: text(v.burrType), notes: text(v.notes) }
        if (grinder) { await updateGrinder(grinder.id, fields); onClose({ ...grinder, ...fields }) } else onClose(await createGrinder(fields))
        return undefined
      }}
    />
  )
}
