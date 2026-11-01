import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { currentGateway } from '../api/gateway'
import { MONO, writeKey } from '../api/store'
import { nextWake, type WakeSchedule } from '../domain/schedule'
import { keyboardResource, withKeyDefaults, type KeyAction, type KeyboardConfig } from '../state/keyboard'
import { machineConnected, scaleConnected, useLive } from '../state/live'
import { requestState } from '../state/machine'
import { ACCENTS, prefsResource, savePref, withDefaults, type Prefs } from '../state/prefs'
import { profiles } from '../state/profiles'
import { useResource } from '../state/resource'
import { addSchedule, appSettings, appUpdate, CHARGING, deleteSchedule, display, firmware, forgetDevice, machineAdvanced, machineSettings, plugins, saveMachineAdvanced, saveMachineSetting, presence, SCALE_POWER, saveSetting, savePresence, setBrightness, setDefaultSkin, pluginSettings, savePluginSettings, setPluginEnabled, setRefillLevel, skins, updateSchedule, type AppSettings, type Plugin, type PluginValues } from '../state/settings'
import { tankMmForPercent, tankPercent } from '../state/water'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DotIcon } from '../ui/DotIcon'
import { clock, fixed, NONE, tempLabel, toUnit } from '../ui/format'
import { TextSheet, ValueSheet } from '../ui/Sheets'
import { errorToast, toast } from '../ui/toasts'
import { ConnectScale } from './ConnectScale'
import './settings.css'

// Layout: section list on the left, cards of controls on the right. Mono's own grouping.

type Section = 'brewing' | 'sleep' | 'devices' | 'machine' | 'maintenance' | 'mono' | 'keyboard' | 'system'
const GROUPS: [string, [Section, string][]][] = [
  ['COFFEE', [['brewing', 'Brewing']]],
  ['MACHINE & DEVICES', [['devices', 'Devices & water'], ['machine', 'Machine'], ['maintenance', 'Maintenance'], ['sleep', 'Sleep & display']]],
  ['MONO', [['mono', 'Look & sound'], ['keyboard', 'Keyboard']]],
  ['SYSTEM', [['system', 'System']]],
]
const TITLES: Record<Section, string> = {
  brewing: 'Brewing',
  sleep: 'Sleep & display',
  devices: 'Devices & water',
  machine: 'Machine',
  maintenance: 'Maintenance',
  mono: 'Look & sound',
  keyboard: 'Keyboard',
  system: 'System',
}

type Edit = { title: string; spec: { label: string; unit: string; min: number; max: number; step: number; decimals: number; offable: boolean }; value: number | null; save: (v: number | null) => Promise<unknown> }

export function Settings({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<Section>('brewing')
  const [edit, setEdit] = useState<Edit | null>(null)
  const run = async (work: () => Promise<unknown>, done?: string) => {
    try { await work(); if (done) toast(done) } catch (error) { errorToast(error) }
  }
  const title = TITLES[section]
  return (
    <div className="settings" data-testid="settings">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="set-nav-head">
          <button type="button" className="icon-button ringed" aria-label="Back to home" onClick={onBack}><DotIcon glyph="back" color="var(--brown-ink)" /></button>
          <h1 className="set-h1">Settings</h1>
        </div>
        {/* Only the section list scrolls; the back button and title stay put. */}
        <div className="set-nav-list">
          {GROUPS.map(([label, items]) => (
            <div key={label} className="set-group">
              <span className="label set-group-label">{label}</span>
              {items.map(([id, name]) => (
                <button key={id} type="button" className="set-nav-item" aria-current={section === id} onClick={() => setSection(id)}>{name}</button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <main className="set-main">
        <h2 className="set-h2">{title}</h2>
        <div className="set-cards" data-testid={`section-${section}`}>
          {section === 'brewing' && <Brewing setEdit={setEdit} run={run} />}
          {section === 'sleep' && <SleepDisplay setEdit={setEdit} run={run} />}
          {section === 'devices' && <Devices setEdit={setEdit} run={run} />}
          {section === 'machine' && <Machine setEdit={setEdit} run={run} />}
          {section === 'maintenance' && <Maintenance run={run} />}
          {section === 'mono' && <LookSound run={run} setEdit={setEdit} />}
          {section === 'keyboard' && <Keyboard run={run} />}
          {section === 'system' && <System run={run} />}
        </div>
      </main>
      {edit && <ValueSheet title={edit.title} spec={edit.spec} value={edit.value} onCancel={() => setEdit(null)} onDone={(v) => { const e = edit; setEdit(null); void run(() => e.save(v), 'Saved') }} />}
    </div>
  )
}

type Run = (work: () => Promise<unknown>, done?: string) => Promise<void>
type SetEdit = (e: Edit | null) => void

function Card({ eyebrow, title, children, wide = false }: { eyebrow: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`set-card${wide ? ' wide' : ''}`} aria-label={title}>
      <span className="set-card-head"><span className="label">{eyebrow}</span><span className="set-card-title">{title}</span></span>
      {children}
    </section>
  )
}

function Toggle({ label, on, onChange, note, detail, extra, disabled = false }: { label: string; on: boolean; onChange: (v: boolean) => void; note?: string; detail?: string; extra?: ReactNode; disabled?: boolean }) {
  return (
    <div className="set-row">
      <span className="set-row-text"><span className="one-line">{label}</span>{note && <span className="label set-note">{note}</span>}{detail && <span className="set-note-serif clamp-2">{detail}</span>}</span>
      {extra}
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}><span /></button>
    </div>
  )
}

function ValueRow({ label, value, onClick, note, disabled = false }: { label: string; value: string; onClick: () => void; note?: string; disabled?: boolean }) {
  return (
    <button type="button" className="set-row set-row-btn" onClick={onClick} disabled={disabled} aria-label={`${label}: ${value}`}>
      <span className="set-row-text"><span>{label}</span>{note && <span className="label set-note">{note}</span>}</span>
      <span className="set-row-v"><ValueText text={String(value)} /></span>
    </button>
  )
}

// A value as the editor shows it: the number in serif, its unit in small mono caps; other text in serif.
function ValueText({ text }: { text: string }) {
  const m = /^(-?[\d.,]+)\s*(.*)$/.exec(text)
  return m ? <><span>{m[1]}</span>{m[2] && <span className="label set-unit">{m[2].toUpperCase()}</span>}</> : <>{text}</>
}

// A few short options that fit on one line. Anything longer is a RadioList.
function Segment<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="set-choice">
      <span className="set-row-text">{label}</span>
      <div role="radiogroup" aria-label={label} className="ed-seg">
        {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>{text.toUpperCase()}</button>)}
      </div>
    </div>
  )
}

// One row per option, the chosen one marked. `label` is shown above the rows unless the card title already says it.
function RadioList<T extends string>({ label, showLabel = true, options, value, onChange }: { label: string; showLabel?: boolean; options: [T, string, ReactNode?][]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="set-radios-wrap">
      {showLabel && <span className="label set-radios-label">{label}</span>}
      <div role="radiogroup" aria-label={label} className="set-radios">
        {options.map(([v, text, lead]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className="set-row set-row-btn" onClick={() => onChange(v)}>
            {lead}
            <span className="set-row-text one-line">{text}</span>
            <span className="radio-mark" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}

function ActionRow({ label, onClick, note, glyph = 'chevron', disabled = false }: { label: string; onClick: () => void; note?: string; glyph?: 'chevron' | 'plus'; disabled?: boolean }) {
  return (
    <button type="button" className="set-row set-row-btn" onClick={onClick} disabled={disabled}>
      <span className="set-row-text"><span>{label}</span>{note && <span className="set-note-serif">{note}</span>}</span>
      <DotIcon glyph={glyph} color="var(--brown)" />
    </button>
  )
}

// ── Brewing ─────────────────────────────────────────────────────────────────────────────────────────

function Brewing({ setEdit, run }: { setEdit: SetEdit; run: Run }) {
  const s = useResource(appSettings).value
  if (!s) return <Loading />
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => run(() => saveSetting(k, v))
  return (
    <>
      <Card eyebrow="SHOTS" title="Starting and stopping">
        <Toggle label="Require a scale to brew" on={s.blockOnNoScale} onChange={(v) => set('blockOnNoScale', v)} />
        <Toggle label="Don't tare during a shot" on={s.blockTareDuringShot} onChange={(v) => set('blockTareDuringShot', v)} />
        <ValueRow label="Early stop for weight" value={`${fixed(s.weightFlowMultiplier, 2)} s`} onClick={() => setEdit({ title: 'EARLY STOP FOR WEIGHT', spec: { label: '', unit: 'S', min: 0, max: 3, step: 0.05, decimals: 2, offable: false }, value: s.weightFlowMultiplier, save: (v) => saveSetting('weightFlowMultiplier', v ?? 0) })} />
      </Card>
      <Card eyebrow="HOT WATER" title="Pouring">
        <Toggle label="Stop hot water at weight" on={s.stopHotWaterAtWeight} onChange={(v) => set('stopHotWaterAtWeight', v)} />
        <ValueRow label="Early stop for hot water" value={`${fixed(s.hotWaterFlowMultiplier, 2)} s`} onClick={() => setEdit({ title: 'EARLY STOP FOR HOT WATER', spec: { label: '', unit: 'S', min: 0, max: 3, step: 0.05, decimals: 2, offable: false }, value: s.hotWaterFlowMultiplier, save: (v) => saveSetting('hotWaterFlowMultiplier', v ?? 0) })} />
      </Card>
    </>
  )
}

// ── Sleep & display ─────────────────────────────────────────────────────────────────────────────────

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function SleepDisplay({ setEdit, run }: { setEdit: SetEdit; run: Run }) {
  const s = useResource(appSettings).value
  const p = useResource(presence).value
  const d = useResource(display).value
  const prefs = withDefaults(useResource(prefsResource).value)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<WakeSchedule | null>(null)
  const [nightEdit, setNightEdit] = useState<'nightModeSleepTime' | 'nightModeMorningTime' | null>(null)
  const [pickWake, setPickWake] = useState(false)
  const records = useResource(profiles).value ?? []
  if (!s || !p) return <Loading />
  const minutesLabel = (m: number) => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return clock(d, prefs.clock) }
  const wakeTitle = prefs.wakeProfile ? records.find((r) => r.id === prefs.wakeProfile)?.profile.title ?? 'Missing profile' : 'Nothing'
  const wake = nextWake(p.schedules, new Date())
  return (
    <>
      <Card eyebrow="DISPLAY" title="Screen">
        <ValueRow label="Brightness" value={d ? `${d.requestedBrightness}%` : NONE} disabled={!d?.platformSupported.brightness} note={d && !d.platformSupported.brightness ? 'NOT SUPPORTED ON THIS TABLET' : undefined} onClick={() => setEdit({ title: 'BRIGHTNESS', spec: { label: '', unit: '%', min: 0, max: 100, step: 5, decimals: 0, offable: false }, value: d?.requestedBrightness ?? 100, save: (v) => setBrightness(v ?? 100) })} />
        <ValueRow label="Sleep screen goes dark after" value={prefs.screenOffAfter ? `${prefs.screenOffAfter} s` : 'Never'} onClick={() => setEdit({ title: 'SLEEP SCREEN GOES DARK AFTER', spec: { label: '', unit: 'S', min: 10, max: 600, step: 10, decimals: 0, offable: true }, value: prefs.screenOffAfter || null, save: (v) => savePref('screenOffAfter', v ?? 0) })} />
        <Toggle label="Keep the screen awake" on={s.keepAwake} onChange={(v) => run(() => saveSetting('keepAwake', v))} />
        <Toggle label="Dim when the tablet battery is low" on={s.lowBatteryBrightnessLimit} onChange={(v) => run(() => saveSetting('lowBatteryBrightnessLimit', v))} />
      </Card>
      <Card eyebrow="SLEEP" title="When the machine sleeps">
        <Toggle label="Sleep when nobody's around" on={p.userPresenceEnabled} onChange={(v) => run(() => savePresence({ userPresenceEnabled: v }))} />
        <ValueRow label="Sleep after" value={`${p.sleepTimeoutMinutes} min`} disabled={!p.userPresenceEnabled} onClick={() => setEdit({ title: 'SLEEP AFTER', spec: { label: '', unit: 'MIN', min: 5, max: 240, step: 5, decimals: 0, offable: false }, value: p.sleepTimeoutMinutes, save: (v) => savePresence({ sleepTimeoutMinutes: v ?? 30 }) })} />
        <Toggle label="Night mode" on={s.nightModeEnabled} onChange={(v) => run(() => saveSetting('nightModeEnabled', v))} />
        {s.nightModeEnabled && <ValueRow label="Night starts" value={minutesLabel(s.nightModeSleepTime)} onClick={() => setNightEdit('nightModeSleepTime')} />}
        {s.nightModeEnabled && <ValueRow label="Morning starts" value={minutesLabel(s.nightModeMorningTime)} onClick={() => setNightEdit('nightModeMorningTime')} />}
        <RadioList label="Tablet charging" value={s.chargingMode} options={(Object.keys(CHARGING) as AppSettings['chargingMode'][]).map((k) => [k, CHARGING[k]])} onChange={(v) => run(() => saveSetting('chargingMode', v))} />
      </Card>
      <Card eyebrow="WAKE" title="Wake schedules" wide>
        <span className="label">{wake ? `NEXT: ${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][wake.getDay()]} ${clock(wake, prefs.clock)}` : 'NO WAKE SCHEDULED'}</span>
        <div className="set-schedules" data-testid="schedules">
          {p.schedules.map((sch) => (
            <div key={sch.id} className="set-schedule" data-testid="schedule">
              <span className="set-schedule-time">{sch.time}</span>
              <span className="label set-schedule-days">{sch.daysOfWeek.length === 0 || sch.daysOfWeek.length === 7 ? 'EVERY DAY' : sch.daysOfWeek.map((dd) => DAY_NAMES[dd - 1]).join(' · ')}</span>
              <button type="button" role="switch" aria-checked={sch.enabled} aria-label={`Wake at ${sch.time}`} className="switch" onClick={() => run(() => updateSchedule(sch.id, { enabled: !sch.enabled }))}><span /></button>
              <button type="button" className="icon-button" aria-label={`Delete wake at ${sch.time}`} onClick={() => setConfirmDelete(sch)}><DotIcon glyph="close" color="var(--brown)" /></button>
            </div>
          ))}
        </div>
        <ActionRow label="Add a wake time" glyph="plus" onClick={() => setAdding(true)} />
        <ValueRow label="Load a profile on wake" value={wakeTitle} onClick={() => setPickWake(true)} />
      </Card>
      {nightEdit && <TimeSheet title={nightEdit === 'nightModeSleepTime' ? 'NIGHT STARTS' : 'MORNING STARTS'} minutes={s[nightEdit]} onCancel={() => setNightEdit(null)} onSave={(m) => { const k = nightEdit; setNightEdit(null); void run(() => saveSetting(k, m), 'Saved') }} />}
      {pickWake && <ProfilePicker records={records.filter((r) => r.visibility === 'visible')} noneLabel="NONE" onCancel={() => setPickWake(false)} onPick={(id) => { setPickWake(false); void run(() => savePref('wakeProfile', id), 'Saved') }} />}
      {adding && <ScheduleSheet onCancel={() => setAdding(false)} onSave={(sch) => { setAdding(false); void run(() => addSchedule(sch), 'Wake time added') }} />}
      {confirmDelete && <ConfirmDialog eyebrow="WAKE SCHEDULE" title={`Delete the ${confirmDelete.time} wake?`} holdLabel="HOLD TO DELETE" onCancel={() => setConfirmDelete(null)} onConfirm={() => { const sch = confirmDelete; setConfirmDelete(null); void run(() => deleteSchedule(sch.id), 'Deleted') }} />}
    </>
  )
}

function ScheduleSheet({ onCancel, onSave }: { onCancel: () => void; onSave: (s: Omit<WakeSchedule, 'id'>) => void }) {
  const [hour, setHour] = useState(6)
  const [minute, setMinute] = useState(30)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onCancel])
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} />
      <section className="sheet set-sched-sheet" role="dialog" aria-modal="true" aria-label="Add a wake time">
        <div className="sheet-handle"><span /></div>
        <span className="label">WAKE AT</span>
        <div className="set-time">
          <Stepper label="Hour" value={hour} onChange={(v) => setHour((v + 24) % 24)} />
          <span className="set-time-sep">:</span>
          <Stepper label="Minute" value={minute} step={5} onChange={(v) => setMinute((v + 60) % 60)} />
        </div>
        <div role="group" aria-label="Days" className="chips">
          {DAY_NAMES.map((n, i) => <button key={n} type="button" className="chip" aria-pressed={days.includes(i + 1)} onClick={() => setDays((d) => (d.includes(i + 1) ? d.filter((x) => x !== i + 1) : [...d, i + 1].sort()))}>{n}</button>)}
        </div>
        <div className="sheet-footer">
          <span className="label">{days.length ? '' : 'PICK AT LEAST ONE DAY'}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" disabled={!days.length} onClick={() => onSave({ time, daysOfWeek: days, enabled: true })}><DotIcon glyph="check" color="#fff" />ADD {time}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stepper({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="set-stepper" role="group" aria-label={label}>
      <button type="button" className="round" aria-label={`${label} down`} onClick={() => onChange(value - step)}>−</button>
      <span className="set-stepper-v" data-testid={`stepper-${label.toLowerCase()}`}>{String(value).padStart(2, '0')}</span>
      <button type="button" className="round" aria-label={`${label} up`} onClick={() => onChange(value + step)}>+</button>
    </div>
  )
}

function TimeSheet({ title, minutes, onCancel, onSave }: { title: string; minutes: number; onCancel: () => void; onSave: (minutes: number) => void }) {
  const [hour, setHour] = useState(Math.floor(minutes / 60) % 24)
  const [minute, setMinute] = useState(minutes % 60)
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onCancel])
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} />
      <section className="sheet set-sched-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle"><span /></div>
        <span className="label">{title}</span>
        <div className="set-time">
          <Stepper label="Hour" value={hour} onChange={(v) => setHour((v + 24) % 24)} />
          <span className="set-time-sep">:</span>
          <Stepper label="Minute" value={minute} step={5} onChange={(v) => setMinute((v + 60) % 60)} />
        </div>
        <div className="sheet-footer">
          <span />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
            <button type="button" className="save" onClick={() => onSave(hour * 60 + minute)}><DotIcon glyph="check" color="#fff" />DONE</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Devices & water ─────────────────────────────────────────────────────────────────────────────────

function Devices({ setEdit, run }: { setEdit: SetEdit; run: Run }) {
  const s = useResource(appSettings).value
  const devices = useLive((l) => l.devices)
  const water = useLive((l) => l.water)
  const [connecting, setConnecting] = useState(false)
  const machine = devices.find((d) => d.type === 'machine' && d.state === 'connected')
  const scale = devices.find((d) => d.type === 'scale' && d.state === 'connected')
  const known = scale ?? devices.find((d) => d.type === 'scale')
  const [forget, setForget] = useState(false)
  if (!s) return <Loading />
  return (
    <>
      <Card eyebrow="CONNECTED" title="Devices" wide>
        <div className="set-row"><span className="set-row-text"><span>Machine</span><span className="label set-note">{machineConnected(devices) ? 'CONNECTED' : 'NOT CONNECTED'}</span></span><span className="set-row-v one-line" data-testid="machine-name"><ValueText text={String(machine?.name ?? NONE)} /></span></div>
        <div className="set-row"><span className="set-row-text"><span>Scale</span><span className="label set-note">{scaleConnected(devices) ? 'CONNECTED' : 'NOT CONNECTED'}</span></span><span className="set-row-v one-line" data-testid="scale-name"><ValueText text={String(scale?.name ?? NONE)} /></span></div>
        <ActionRow label="Connect a scale" onClick={() => setConnecting(true)} />
        {scale && <ActionRow label="Disconnect the scale" onClick={() => run(() => api.put('/api/v1/devices/disconnect', { deviceId: scale.id }), 'Scale disconnected')} />}
        {known && <ActionRow label="Forget the scale" onClick={() => setForget(true)} />}
      </Card>
      <Card eyebrow="SCALE" title="When the machine sleeps">
        <RadioList label="The scale should" value={s.scalePowerMode} options={(Object.keys(SCALE_POWER) as AppSettings['scalePowerMode'][]).map((k) => [k, SCALE_POWER[k]])} onChange={(v) => run(() => saveSetting('scalePowerMode', v))} />
      </Card>
      <Card eyebrow="WATER" title="Tank">
        <div className="set-row"><span className="set-row-text">Water now</span><span className="set-row-v" data-testid="tank-now"><ValueText text={String(water ? `${tankPercent(water.currentLevel)}%` : NONE)} /></span></div>
        <ValueRow label="Warn when the tank is below" value={water ? `${tankPercent(water.refillLevel)}%` : NONE} disabled={!water} onClick={() => setEdit({ title: 'WARN WHEN THE TANK IS BELOW', spec: { label: '', unit: '%', min: 5, max: 50, step: 1, decimals: 0, offable: false }, value: tankPercent(water?.refillLevel) ?? 7, save: (v) => setRefillLevel(tankMmForPercent(v ?? 7)) })} />
      </Card>
      {connecting && <ConnectScale onClose={() => setConnecting(false)} />}
      {forget && known && <ConfirmDialogPlain title={`Forget ${known.name}?`} body="Decaid won't reconnect to it on its own." confirm="FORGET" onCancel={() => setForget(false)} onConfirm={() => { setForget(false); void run(() => forgetDevice(known.id), `${known.name} forgotten`) }} />}
    </>
  )
}

// ── Machine ─────────────────────────────────────────────────────────────────────────────────────────

const REFILL_KIT: [string, string][] = [['2', 'Detect it'], ['1', 'Fitted'], ['0', 'Not fitted']]

function Machine({ setEdit, run }: { setEdit: SetEdit; run: Run }) {
  const m = useResource(machineSettings).value
  const a = useResource(machineAdvanced).value
  const units = withDefaults(useResource(prefsResource).value).units
  if (!m || !a) return <Loading />
  // Temperatures are kept in °C; shown and entered in the chosen unit.
  const temp = (title: string, celsius: number, min: number, max: number, save: (c: number) => Promise<unknown>) => setEdit({
    title, value: Math.round(toUnit(Math.min(max, Math.max(min, celsius)), units)), // the machine can report values outside its own range
    spec: { label: '', unit: tempLabel(units), min: Math.round(toUnit(min, units)), max: Math.round(toUnit(max, units)), step: 1, decimals: 0, offable: false },
    save: (v) => save(units === 'f' ? Math.round((((v ?? 0) - 32) * 5) / 9) : v ?? min),
  })
  const t = (c: number) => `${fixed(toUnit(c, units), 0)} ${tempLabel(units)}`
  return (
    <>
      <Card eyebrow="MACHINE" title="Fan and charging">
        <ValueRow label="Fan turns on above" value={t(m.fan)} onClick={() => temp('FAN TURNS ON ABOVE', m.fan, 0, 50, (c) => saveMachineSetting('fan', c))} />
        <Toggle label="USB charging port" on={m.usb} onChange={(v) => run(() => saveMachineSetting('usb', v))} />
        <ValueRow label="Water tank warmed to" value={t(m.tankTemp)} onClick={() => temp('WATER TANK WARMED TO', m.tankTemp, 10, 40, (c) => saveMachineSetting('tankTemp', c))} />
      </Card>
      <Card eyebrow="STEAM" title="Steam and refill">
        <Segment label="After steaming" value={String(m.steamPurgeMode)} options={[['0', 'Purge by itself'], ['1', 'Tap twice to stop']]} onChange={(v) => run(() => saveMachineSetting('steamPurgeMode', Number(v)))} />
        <Segment label="Refill kit" value={String(a.refillKitSetting)} options={REFILL_KIT} onChange={(v) => run(() => saveMachineAdvanced('refillKitSetting', Number(v)))} />
      </Card>
      <Card eyebrow="HEATER" title="Heater (for technicians)" wide>
        <span className="set-note-serif">Leave these alone unless Decent support asks.</span>
        <ValueRow label="Idle temperature" value={t(a.heaterIdleTemp)} onClick={() => temp('IDLE TEMPERATURE', a.heaterIdleTemp, 0, 99, (c) => saveMachineAdvanced('heaterIdleTemp', c))} />
        <ValueRow label="Warm-up flow" value={`${fixed(a.heaterPh1Flow, 1)} ml/s`} onClick={() => setEdit({ title: 'WARM-UP FLOW', spec: { label: '', unit: 'ML/S', min: 0, max: 10, step: 0.1, decimals: 1, offable: false }, value: a.heaterPh1Flow, save: (v) => saveMachineAdvanced('heaterPh1Flow', v ?? 0) })} />
        <ValueRow label="Test flow" value={`${fixed(a.heaterPh2Flow, 1)} ml/s`} onClick={() => setEdit({ title: 'TEST FLOW', spec: { label: '', unit: 'ML/S', min: 0, max: 10, step: 0.1, decimals: 1, offable: false }, value: a.heaterPh2Flow, save: (v) => saveMachineAdvanced('heaterPh2Flow', v ?? 0) })} />
        <ValueRow label="Test time-out" value={`${fixed(a.heaterPh2Timeout, 0)} s`} onClick={() => setEdit({ title: 'TEST TIME-OUT', spec: { label: '', unit: 'S', min: 0, max: 60, step: 1, decimals: 0, offable: false }, value: a.heaterPh2Timeout, save: (v) => saveMachineAdvanced('heaterPh2Timeout', v ?? 0) })} />
        {a.heaterVoltage ? <div className="set-row"><span className="set-row-text">Mains voltage</span><span className="set-row-v"><ValueText text={`${a.heaterVoltage} V`} /></span></div> : null}
      </Card>
    </>
  )
}

// ── Maintenance ─────────────────────────────────────────────────────────────────────────────────────

const MAINTENANCE: [string, string, 'cleaning' | 'descaling' | 'airPurge', string][] = [
  ['Clean', 'Blind basket and a cleaning tablet in first.', 'cleaning', 'HOLD TO CLEAN'],
  ['Descale', 'Descaler in the tank first. Takes about 20 minutes.', 'descaling', 'HOLD TO DESCALE'],
  ['Transport mode', 'Drains the machine for moving or storage. Take the tank out first.', 'airPurge', 'HOLD TO EMPTY'],
]

function Maintenance({ run }: { run: Run }) {
  const fw = useResource(firmware).value as unknown as { machine?: { model?: string; build?: number }; updateAvailable?: boolean; recommendedArtifactId?: string } | null
  const state = useLive((l) => l.machine?.state.state)
  const [confirm, setConfirm] = useState<(typeof MAINTENANCE)[number] | null>(null)
  return (
    <>
      <Card eyebrow="CARE" title="Clean, descale, transport" wide>
        {MAINTENANCE.map((m) => (
          <ActionRow key={m[2]} label={m[0]} disabled={!!state && state !== 'idle'} onClick={() => setConfirm(m)} />
        ))}
        <span className="label">{state && state !== 'idle' ? 'THE MACHINE MUST BE IDLE' : ''}</span>
      </Card>
      <Card eyebrow="FIRMWARE" title="Machine firmware" wide>
        <div className="set-row"><span className="set-row-text">Installed</span><span className="set-row-v" data-testid="fw-build"><ValueText text={String(fw?.machine?.build ? `Build ${fw.machine.build}` : NONE)} /></span></div>
        {fw?.updateAvailable && <div className="set-row"><span className="set-row-text"><span>Available</span><span className="label set-note">INSTALL FROM DECAID'S SETTINGS</span></span><span className="set-row-v" data-testid="fw-latest"><ValueText text={String(String(fw.recommendedArtifactId ?? '').replace(/^de1-/, 'Build '))} /></span></div>}
      </Card>
      {confirm && <ConfirmDialog eyebrow="MAINTENANCE" title={`${confirm[0]}?`} body={confirm[1]} keepLabel="NOT NOW" holdLabel={confirm[3]} onCancel={() => setConfirm(null)} onConfirm={() => { const m = confirm; setConfirm(null); void run(() => requestState(m[2] as never), `${m[0]} started`) }} />}
    </>
  )
}

// ── Look & sound ────────────────────────────────────────────────────────────────────────────────────

const ACCENT_NAMES: Record<keyof typeof ACCENTS, string> = { crema: 'Crema', rust: 'Rust', slate: 'Slate blue', teal: 'Teal' }

function LookSound({ run }: { run: Run; setEdit: SetEdit }) {
  const prefs = withDefaults(useResource(prefsResource).value)
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => run(() => savePref(k, v))
  return (
    <>
      <Card eyebrow="CHARTS" title="Flow colour">
        <RadioList label="Flow colour" showLabel={false} value={prefs.accent} onChange={(k) => set('accent', k)} options={(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((k) => [k, ACCENT_NAMES[k], <svg key="dots" width={45} height={18} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={4.5 + i * 9} cy={9} r={3} fill={ACCENTS[k]} />)}</svg>])} />
      </Card>
      <Card eyebrow="UNITS" title="Units and time">
        <Segment label="Temperature" value={prefs.units} options={[['c', '°C'], ['f', '°F']]} onChange={(v) => set('units', v)} />
        <Segment label="Clock" value={prefs.clock} options={[['24', '24-HOUR'], ['12', '12-HOUR']]} onChange={(v) => set('clock', v)} />
      </Card>
      <Card eyebrow="SOUND" title="Sound">
        <Toggle label="Play a sound when a shot finishes" on={prefs.completionSound} onChange={(v) => set('completionSound', v)} />
      </Card>
      <Card eyebrow="LANGUAGE" title="Language">
        <div className="set-row"><span className="set-row-text">Mono's language</span><span className="set-row-v" data-testid="language"><ValueText text="English" /></span></div>
      </Card>
    </>
  )
}

// ── Keyboard ────────────────────────────────────────────────────────────────────────────────────────

const ACTION_NAMES: Record<KeyAction, string> = { espresso: 'Espresso', hotWater: 'Hot water', steam: 'Steam', flush: 'Flush', stop: 'Stop', sleep: 'Sleep' }
const keyName = (k: string) => (k === ' ' ? 'SPACE' : k.length === 1 ? k.toUpperCase() : k.toUpperCase())

function Keyboard({ run }: { run: Run }) {
  const stored = useResource(keyboardResource).value
  const cfg = withKeyDefaults(stored)
  const records = useResource(profiles).value ?? []
  const [rebind, setRebind] = useState<{ kind: 'action'; action: KeyAction } | { kind: 'profile'; profileId: string } | null>(null)
  const [conflict, setConflict] = useState<{ key: string; apply: () => void; owner: string } | null>(null)
  const [pickProfile, setPickProfile] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const save = (next: KeyboardConfig) => run(async () => { await writeKey(MONO, 'keyboard', next); await keyboardResource.refresh() })
  const ownerOf = (key: string): string | null => {
    const a = (Object.keys(cfg.actions) as KeyAction[]).find((x) => cfg.actions[x] === key)
    if (a) return ACTION_NAMES[a]
    const pid = cfg.profiles[key]
    return pid ? records.find((r) => r.id === pid)?.profile.title ?? 'a profile' : null
  }
  const removeKey = (c: KeyboardConfig, key: string): KeyboardConfig => {
    const actions = { ...c.actions }
    for (const a of Object.keys(actions) as KeyAction[]) if (actions[a] === key) actions[a] = ''
    const prof = { ...c.profiles }
    delete prof[key]
    return { ...c, actions, profiles: prof }
  }

  // Capture the next key press for a rebind. Esc cancels.
  useEffect(() => {
    if (!rebind) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRebind(null); return }
      if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Enter'].includes(e.key)) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const target = rebind
      setRebind(null)
      const apply = () => {
        let next = removeKey(cfg, key)
        if (target.kind === 'action') next = { ...next, actions: { ...next.actions, [target.action]: key } }
        else {
          const prof = Object.fromEntries(Object.entries(next.profiles).filter(([, v]) => v !== target.profileId))
          next = { ...next, profiles: { ...prof, [key]: target.profileId } }
        }
        void save(next)
      }
      const owner = ownerOf(key)
      const same = target.kind === 'action' ? cfg.actions[target.action] === key : cfg.profiles[key] === target.profileId
      if (owner && !same) setConflict({ key, apply, owner })
      else if (!same) apply()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rebind, cfg])

  return (
    <>
      <Card eyebrow="SHORTCUTS" title="Keyboard shortcuts" wide>
        <Toggle label="Use keyboard shortcuts" on={cfg.enabled} onChange={(v) => save({ ...cfg, enabled: v })} />
        <div className="set-keys" data-testid="key-actions">
          {(Object.keys(ACTION_NAMES) as KeyAction[]).map((a) => (
            <button key={a} type="button" className="set-row set-row-btn" aria-label={`Rebind ${ACTION_NAMES[a]}`} onClick={() => setRebind({ kind: 'action', action: a })}>
              <span className="set-row-text">{ACTION_NAMES[a]}</span>
              {rebind?.kind === 'action' && rebind.action === a ? <span className="label">PRESS A KEY…</span> : <span className="set-key" data-testid={`key-${a}`}>{cfg.actions[a] ? keyName(cfg.actions[a]) : NONE}</span>}
            </button>
          ))}
        </div>
      </Card>
      <Card eyebrow="PROFILES" title="Profile keys" wide>
        {Object.entries(cfg.profiles).map(([key, pid]) => (
          <div key={key} className="set-row" data-testid="profile-key">
            <button type="button" className="set-row-main" aria-label={`Change key for ${records.find((r) => r.id === pid)?.profile.title ?? pid}`} onClick={() => setRebind({ kind: 'profile', profileId: pid })}>
              <span className="set-row-text one-line">{records.find((r) => r.id === pid)?.profile.title ?? 'Missing profile'}</span>
              {rebind?.kind === 'profile' && rebind.profileId === pid ? <span className="label">PRESS A KEY…</span> : <span className="set-key">{keyName(key)}</span>}
            </button>
            <button type="button" className="icon-button" aria-label={`Remove key ${keyName(key)}`} onClick={() => save(removeKey(cfg, key))}><DotIcon glyph="close" color="var(--brown)" /></button>
          </div>
        ))}
        <ActionRow label="Add a profile key" glyph="plus" onClick={() => setPickProfile(true)} />
        <ActionRow label="Reset shortcuts to defaults" disabled={!stored} onClick={() => setConfirmReset(true)} />
      </Card>
      {pickProfile && <ProfilePicker records={records.filter((r) => r.visibility === 'visible' && !Object.values(cfg.profiles).includes(r.id))} onCancel={() => setPickProfile(false)} onPick={(id) => { setPickProfile(false); setRebind({ kind: 'profile', profileId: id }) }} />}
      {rebind && <div className="set-capture" role="status" data-testid="capture">PRESS A KEY · ESC TO CANCEL</div>}
      {conflict && <ConfirmDialogPlain title={`${keyName(conflict.key)} is already ${conflict.owner}’s key. Move it?`} confirm="MOVE IT" onCancel={() => setConflict(null)} onConfirm={() => { const c = conflict; setConflict(null); c.apply() }} />}
      {confirmReset && <ConfirmDialog eyebrow="KEYBOARD" title="Reset shortcuts?" body="Back to E, W, S, F, Space and P. Profile keys are cleared." keepLabel="KEEP MINE" holdLabel="HOLD TO RESET" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void run(async () => { await api.del(`/api/v1/store/${MONO}/keyboard`); await keyboardResource.refresh() }, 'Shortcuts reset') }} />}
    </>
  )
}

function ConfirmDialogPlain({ title, body, confirm, onCancel, onConfirm }: { title: string; body?: string; confirm: string; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onCancel])
  return (
    <div className="confirm-layer">
      <div className="scrim" onClick={onCancel} />
      <section className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <span className="confirm-title">{title}</span>
        {body && <span className="confirm-body">{body}</span>}
        <div className="confirm-actions">
          <button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button>
          <button type="button" className="save" onClick={onConfirm}><DotIcon glyph="check" color="#fff" />{confirm}</button>
        </div>
      </section>
    </div>
  )
}

function ProfilePicker({ records, onCancel, onPick, noneLabel }: { records: { id: string; profile: { title: string } }[]; onCancel: () => void; onPick: (id: string) => void; noneLabel?: string }) {
  const [q, setQ] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onCancel])
  const list = records.filter((r) => r.profile.title.toLowerCase().includes(q.toLowerCase())).slice(0, 60)
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onCancel} />
      <section className="sheet set-picker" role="dialog" aria-modal="true" aria-label="Choose a profile">
        <div className="sheet-handle"><span /></div>
        <label className="lib-search"><DotIcon glyph="search" color="var(--taupe)" /><input type="search" aria-label="Search profiles" placeholder="SEARCH" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
        <div className="set-picker-list">
          {noneLabel && !q && <button type="button" className="set-row set-row-btn" onClick={() => onPick('')}><span className="set-row-text label">{noneLabel}</span></button>}
          {list.map((r) => <button key={r.id} type="button" className="set-row set-row-btn" onClick={() => onPick(r.id)} aria-label={r.profile.title}><span className="set-row-text one-line">{r.profile.title}</span></button>)}
        </div>
        <div className="sheet-footer"><span /><button type="button" className="quiet-button" onClick={onCancel}>CANCEL</button></div>
      </section>
    </div>
  )
}

// ── System ──────────────────────────────────────────────────────────────────────────────────────────

function System({ run }: { run: Run }) {
  const up = useResource(appUpdate).value
  const plug = useResource(plugins).value ?? []
  const sk = useResource(skins).value ?? []
  const s = useResource(appSettings).value
  const [restore, setRestore] = useState<File | null>(null)
  const [skinTo, setSkinTo] = useState<string | null>(null)
  const [pluginOpen, setPluginOpen] = useState<Plugin | null>(null)
  const exitToDashboard = (window as unknown as { decentApp?: { exitToDashboard?: () => void } }).decentApp?.exitToDashboard

  const download = async (path: string, name: string) => {
    const res = await fetch(currentGateway().http + path)
    if (!res.ok) throw new Error(`Couldn't download (${res.status})`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000)
  }

  return (
    <>
      <Card eyebrow="DECAID" title="Updates">
        <div className="set-row"><span className="set-row-text"><span>Decaid version</span>{up?.latestVersion && <span className="label set-note">{up.latestVersion} AVAILABLE</span>}</span><span className="set-row-v" data-testid="app-version"><ValueText text={String(up?.currentVersion ?? NONE)} /></span></div>
        {s && <Toggle label="Check for updates automatically" on={s.automaticUpdateCheck} onChange={(v) => run(() => saveSetting('automaticUpdateCheck', v))} />}
      </Card>
      <Card eyebrow="DATA" title="Backup and logs">
        <ActionRow label="Download a backup" onClick={() => run(() => download('/api/v1/data/export', `decaid-backup-${new Date().toISOString().slice(0, 10)}.json`), 'Backup downloaded')} />
        <label className="set-row set-row-btn"><span className="set-row-text">Restore a backup</span><DotIcon glyph="chevron" color="var(--brown)" /><input type="file" accept=".json,application/json" hidden data-testid="restore-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRestore(f) }} /></label>
        <ActionRow label="Download logs" onClick={() => run(() => download('/api/v1/logs', 'decaid-logs.txt'), 'Logs downloaded')} />
      </Card>
      <Card eyebrow="EXTENSIONS" title="Plugins" wide>
        {plug.map((p) => <Toggle key={p.id} label={p.name} on={p.autoLoad === true} note={p.autoLoad && p.loaded === false ? 'FAILED TO START' : undefined} detail={p.description || undefined} extra={Object.keys(p.settings ?? {}).length ? <button type="button" className="icon-button" aria-label={`${p.name} settings`} onClick={() => setPluginOpen(p)}><DotIcon glyph="settings" color="var(--brown)" /></button> : undefined} onChange={(v) => run(() => setPluginEnabled(p.id, v).catch(() => { throw new Error(`Couldn't turn ${v ? 'on' : 'off'} ${p.name}.`) }), v ? `${p.name} on` : `${p.name} off`)} />)}
      </Card>
      <Card eyebrow="DECAID OPENS WITH" title="Skin" wide>
        <RadioList label="Skin" showLabel={false} value={s?.defaultSkinId} onChange={(id) => s?.defaultSkinId !== id && setSkinTo(id)} options={sk.map((k) => [k.id, k.name, undefined])} />
        {exitToDashboard && <ActionRow label="Exit to Decaid" onClick={() => exitToDashboard()} />}
      </Card>
      {pluginOpen && <PluginSettingsSheet plugin={pluginOpen} onClose={() => setPluginOpen(null)} />}
      {restore && <ConfirmDialog eyebrow="RESTORE" title="Restore this backup?" body={`Replaces your profiles, shots and settings with “${restore.name}”.`} holdLabel="HOLD TO RESTORE" onCancel={() => setRestore(null)} onConfirm={() => { const f = restore; setRestore(null); void run(async () => api.post('/api/v1/data/import', JSON.parse(await f.text())), 'Backup restored') }} />}
      {skinTo && <ConfirmDialogPlain title={`Switch to ${sk.find((k) => k.id === skinTo)?.name ?? skinTo}?`} body="Takes effect next time Decaid opens." confirm="SWITCH" onCancel={() => setSkinTo(null)} onConfirm={() => { const id = skinTo; setSkinTo(null); void run(async () => { await setDefaultSkin(id); await appSettings.refresh() }, 'Skin switched') }} />}
    </>
  )
}

// A plugin's own settings, built from what its manifest declares (as Decaid's plugin page does).
// Only changed values are sent; a password is never shown, only whether one is saved.
function PluginSettingsSheet({ plugin, onClose }: { plugin: Plugin; onClose: () => void }) {
  const schema = Object.entries(plugin.settings ?? {})
  const [saved, setSaved] = useState<PluginValues | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const load = () => {
    setFailed(false)
    pluginSettings(plugin.id).then(setSaved, (error) => { console.warn('[mono]', error); setFailed(true) })
  }
  useEffect(load, [plugin.id])
  // Esc closes this sheet, unless a field's text sheet is open on top (Esc closes only that).
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose, editing])
  const shown = (key: string) => (key in draft ? draft[key] : saved?.[key] ?? plugin.settings?.[key]?.default)
  const set = (key: string, v: unknown) => setDraft((d) => ({ ...d, [key]: v }))
  const badNumber = schema.find(([k, sc]) => sc.type === 'number' && !sc.secure && typeof draft[k] === 'string' && (draft[k] as string).trim() !== '' && !Number.isFinite(Number(draft[k])))
  const patch = () => Object.fromEntries(Object.entries(draft).flatMap(([k, v]) => {
    const sc = plugin.settings?.[k]
    if (sc?.secure) return v === null ? [[k, null]] : typeof v === 'string' && v ? [[k, sc.type === 'number' ? Number(v) : v]] : []
    const value = sc?.type === 'number' && typeof v === 'string' ? (v.trim() === '' ? null : Number(v)) : v
    return value === (saved?.[k] ?? null) ? [] : [[k, value]]
  }))
  const save = async () => {
    const changes = patch()
    if (!Object.keys(changes).length) { onClose(); return }
    setSaving(true)
    try { await savePluginSettings(plugin.id, changes); toast(`${plugin.name} settings saved`); onClose() } catch (error) { errorToast(error, `Couldn't save ${plugin.name} settings.`) } finally { setSaving(false) }
  }
  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onClose} />
      <section className="sheet set-plugin-sheet" role="dialog" aria-modal="true" aria-label={`${plugin.name} settings`}>
        <div className="sheet-handle"><span /></div>
        <h2 className="set-plugin-title one-line">{plugin.name}</h2>
        <div className="set-plugin-body">
          {failed && (
            <div className="set-plugin-error" role="alert">
              <span className="set-plugin-error-text">Couldn't load these settings.</span>
              <button type="button" className="chip" onClick={load}>TRY AGAIN</button>
            </div>
          )}
          {!failed && !saved && <Loading />}
          {saved && schema.map(([key, sc]) => {
            const label = sc.label?.trim() || key
            const detail = sc.description && !restates(sc.description, label) ? sc.description : undefined
            if (sc.type === 'boolean' && !sc.secure) return <Toggle key={key} label={label} detail={detail} on={shown(key) === true} onChange={(v) => set(key, v)} />
            if (sc.type === 'enum' && !sc.secure) return <RadioList key={key} label={label} value={shown(key) as string | undefined} options={(sc.values ?? []).map((v) => [v, v, undefined])} onChange={(v) => set(key, v)} />
            // Text, numbers and passwords: a row like any other setting; tapping it opens the text sheet.
            const shownText = sc.secure
              ? (draft[key] === null ? 'Not set' : typeof draft[key] === 'string' && draft[key] ? 'Changed' : (saved[key] as { isSet?: boolean } | undefined)?.isSet ? 'Saved' : 'Not set')
              : shown(key) === null || shown(key) === undefined || shown(key) === '' ? '' : String(shown(key))
            const isSet = sc.secure && (saved[key] as { isSet?: boolean } | undefined)?.isSet === true && draft[key] !== null
            return (
              <div key={key} className="set-row set-plugin-row">
                <button type="button" className="set-row-main" aria-label={`${label}: ${shownText || 'empty'}`} onClick={() => setEditing(key)}>
                  <span className="set-row-text"><span>{label}</span>{detail && <span className="set-note-serif clamp-2">{detail}</span>}</span>
                  <span className={`set-row-v one-line${shownText ? '' : ' empty'}`}><ValueText text={String(shownText || 'Tap to edit')} /></span>
                </button>
                {isSet && <button type="button" className="icon-button" aria-label={`Clear ${label}`} onClick={() => set(key, null)}><DotIcon glyph="close" color="var(--brown)" /></button>}
              </div>
            )
          })}
        </div>
        {editing && plugin.settings?.[editing] && (() => {
          const sc = plugin.settings[editing]
          const current = sc.secure ? '' : shown(editing) === null || shown(editing) === undefined ? '' : String(shown(editing))
          return <TextSheet label={(sc.label?.trim() || editing).toUpperCase()} value={current} multiline={false} maxLength={200} secret={sc.secure} numeric={sc.type === 'number'} onCancel={() => setEditing(null)} onDone={(v) => { const k = editing; setEditing(null); if (sc.secure && !v) return; set(k, v) }} />
        })()}
        <div className="sheet-footer">
          <span className="label">{badNumber ? `${(badNumber[1].label?.trim() || badNumber[0]).toUpperCase()}: NUMBERS ONLY` : ''}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {/* Nothing to save until the settings have loaded. */}
            <button type="button" className="quiet-button" onClick={onClose}>{saved ? 'CANCEL' : 'CLOSE'}</button>
            {saved && <button type="button" className="save" disabled={saving || !!badNumber} onClick={save}><DotIcon glyph="check" color="#fff" />SAVE</button>}
          </div>
        </div>
      </section>
    </div>
  )
}

// Plugin descriptions often just repeat the label ("Visualiser username"); those aren't shown.
const restates = (description: string, label: string) => {
  const norm = (t: string) => t.toLowerCase().replace(/s(?=e?r?\b)/g, 'z').replace(/[^a-z0-9]/g, '')
  return norm(label).includes(norm(description)) || norm(description).includes(norm(label)) && description.length < label.length + 12
}

function Loading() {
  return <span className="label">LOADING…</span>
}
