import { MONO, readKey } from '../api/store'
import { createResource } from './resource'

// Keyboard shortcuts. Stored in Decaid's store under mono/keyboard;
// defaults live here and are never written until the person changes something.

export type KeyAction = 'espresso' | 'hotWater' | 'steam' | 'flush' | 'stop' | 'sleep'
export interface KeyboardConfig {
  enabled: boolean
  actions: Record<KeyAction, string> // KeyboardEvent.key, lower case (' ' for Space)
  profiles: Record<string, string> // key → profile id
}

export const DEFAULT_KEYS: KeyboardConfig = {
  enabled: true,
  actions: { espresso: 'e', hotWater: 'w', steam: 's', flush: 'f', stop: ' ', sleep: 'p' },
  profiles: {},
}

export function withKeyDefaults(stored: Partial<KeyboardConfig> | null): KeyboardConfig {
  return {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : DEFAULT_KEYS.enabled,
    actions: { ...DEFAULT_KEYS.actions, ...(stored?.actions ?? {}) },
    profiles: { ...(stored?.profiles ?? {}) },
  }
}

export const keyboardResource = createResource(() => readKey<Partial<KeyboardConfig>>(MONO, 'keyboard'), 30_000)

const RUNNING_ACTION: Record<string, KeyAction> = { espresso: 'espresso', hotWater: 'hotWater', steam: 'steam', flush: 'flush' }

// Text-entry contexts, where letters are typing rather than commands.
const TEXT_ENTRY = 'input, select, textarea, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]'

export type KeyDecision =
  | { kind: 'none' }
  | { kind: 'start'; action: Exclude<KeyAction, 'stop'> }
  | { kind: 'stop' }
  | { kind: 'profile'; profileId: string }

export interface KeyContext {
  machineState: string | undefined
  onHome: boolean // Home is showing with nothing over it
  dialogOpen: boolean // a sheet or other blocking dialog (not the running modal)
}

// What a key press does, given where the person is. Pure, so the rules are unit-tested.
export function decideKey(e: Pick<KeyboardEvent, 'key' | 'repeat' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'> & { target?: EventTarget | null }, config: KeyboardConfig, ctx: KeyContext): KeyDecision {
  if (!config.enabled || e.repeat || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return { kind: 'none' }
  const el = e.target as Element | null | undefined
  if (el && typeof el.closest === 'function' && el.closest(TEXT_ENTRY)) return { kind: 'none' }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const running = ctx.machineState ? RUNNING_ACTION[ctx.machineState] : undefined
  if (running) {
    // While something runs: Stop, or the running action's own key, stops it — on any screen.
    if (key === config.actions.stop || key === config.actions[running]) return { kind: 'stop' }
    return { kind: 'none' }
  }
  if (!ctx.onHome || ctx.dialogOpen || ctx.machineState === 'sleeping') return { kind: 'none' }
  for (const action of ['espresso', 'hotWater', 'steam', 'flush', 'sleep'] as const) {
    if (key === config.actions[action]) return { kind: 'start', action }
  }
  const profileId = config.profiles[key]
  if (profileId) return { kind: 'profile', profileId }
  return { kind: 'none' }
}
