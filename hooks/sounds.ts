/**
 * The pane's sounds (plan 09, the user's request of 2026-11-19): sci-fi cues
 * for the session's events, each with a switch of its own under one switch for
 * them all. Only decisions here: which events a change of state raises, and
 * which one sounds now. register.tsx plays them.
 */
import type { AgentState, TreeState } from '../types'
import { LIMIT_THRESHOLDS } from './format'
import type { LimitThresholds } from './format'
import { isMember, runEnded } from './model'
import type { OptionField } from './words'

export type SoundEvent = 'advisor' | 'spawn' | 'done' | 'failed' | 'waiting' | 'turn' | 'alert' | 'boot'

/** The events in the order the sounds page lists them. */
export const SOUND_EVENTS: readonly SoundEvent[] = ['advisor', 'spawn', 'done', 'failed', 'waiting', 'turn', 'alert', 'boot']

/** Which sounds first when several come at once: what needs the person most. */
const PRIORITY: readonly SoundEvent[] = ['alert', 'failed', 'waiting', 'turn', 'done', 'advisor', 'spawn', 'boot']

/** Each event's switch among the options (`advisorSound` kept from before, now the advisor event's). */
export const SOUND_OPTION: Readonly<Record<SoundEvent, OptionField>> = {
  advisor: 'advisorSound',
  spawn: 'soundSpawn',
  done: 'soundDone',
  failed: 'soundFailed',
  waiting: 'soundWaiting',
  turn: 'soundTurn',
  alert: 'soundAlert',
  boot: 'soundBoot',
}

/** The event's file among the plugin's own (`sounds/<event>.wav`). */
export function soundFile(event: SoundEvent): string {
  return `sounds/${event}.wav`
}

/** A tune of beeps, [Hz, ms], for a Windows terminal where the file could not be played. */
export const SOUND_BEEPS: Readonly<Record<SoundEvent, ReadonlyArray<readonly [number, number]>>> = {
  advisor: [
    [1319, 70],
    [1976, 90],
  ],
  spawn: [
    [660, 60],
    [990, 70],
  ],
  done: [
    [1319, 80],
    [1976, 120],
  ],
  failed: [
    [523, 150],
    [392, 200],
  ],
  waiting: [[1250, 160]],
  turn: [
    [1047, 70],
    [1319, 70],
    [1568, 70],
    [2093, 140],
  ],
  alert: [
    [740, 140],
    [740, 140],
  ],
  boot: [
    [440, 80],
    [880, 80],
    [1760, 120],
  ],
}

/** One event at most this often. */
export const SOUND_GAP_MS = 2000
/** Any two sounds at least this far apart. */
export const ANY_GAP_MS = 500
/** The context share from which the alert sounds (the weather's red, `↯`). */
export const CRITICAL_CONTEXT = 90

/** What the sounds last heard of the session: to tell what changed since. */
export type Heard = {
  agents: Readonly<Record<string, AgentState>>
  /** Each run: whether it had ended. */
  runs: Readonly<Record<string, boolean>>
  busy: boolean
  advisor: number
  critical: boolean
}

/** Whether the context or a limit stands at its red mark. */
export function isCritical(s: TreeState, thresholds: LimitThresholds = LIMIT_THRESHOLDS): boolean {
  const ctx = s.main.contextPercent
  if (ctx !== undefined && !s.main.contextEstimated && ctx >= CRITICAL_CONTEXT) return true
  return (s.main.limits ?? []).some(l => l.percent >= thresholds.alert)
}

/** What the sounds hear of a state. An agent the spawn has not named yet (`bare`) is not heard until it has been. */
export function heardOf(s: TreeState, thresholds?: LimitThresholds): Heard {
  const agents: Record<string, AgentState> = {}
  for (const a of s.agents) if (!a.bare) agents[a.id] = a.state
  const runs: Record<string, boolean> = {}
  for (const r of s.runs ?? []) runs[r.id] = runEnded(r)
  return { agents, runs, busy: s.main.isBusy, advisor: s.advisor.total, critical: isCritical(s, thresholds) }
}

const ACTIVE: readonly AgentState[] = ['starting', 'running', 'waiting']

/**
 * The events a change of state raises, each once. A workflow run's agents are
 * not heard starting or ending well (as the log does not tell of them), only
 * failing; the run's own end is.
 */
export function soundEvents(prev: Heard, s: TreeState, thresholds?: LimitThresholds): SoundEvent[] {
  const out = new Set<SoundEvent>()
  for (const a of s.agents) {
    if (a.bare) continue
    const before = prev.agents[a.id]
    const member = isMember(s, a)
    if (before === undefined) {
      if (!member && ACTIVE.includes(a.state)) out.add('spawn')
      if (a.state === 'waiting') out.add('waiting')
      continue
    }
    if (before === a.state) continue
    if (a.state === 'done' && !member) out.add('done')
    if (a.state === 'failed') out.add('failed')
    if (a.state === 'waiting') out.add('waiting')
  }
  for (const r of s.runs ?? []) {
    // Only a run heard at work that has now ended: one first seen ended says nothing.
    if (prev.runs[r.id] !== false || !runEnded(r)) continue
    if (r.end === 'failed') out.add('failed')
    else if (r.end === 'completed' || r.end === undefined) out.add('done')
  }
  if (prev.busy && !s.main.isBusy) out.add('turn')
  if (s.advisor.total > prev.advisor) out.add('advisor')
  if (!prev.critical && isCritical(s, thresholds)) out.add('alert')
  return PRIORITY.filter(e => out.has(e))
}

/**
 * The one event that sounds now, of those raised and switched on: the most
 * important, unless it sounded within its gap or any sound did within the
 * common one. `last` holds when each sounded, `any` under that key.
 */
export function pickSound(events: readonly SoundEvent[], on: (e: SoundEvent) => boolean, last: Readonly<Record<string, number>>, now: number): SoundEvent | undefined {
  if (now - (last.any ?? -Infinity) < ANY_GAP_MS) return undefined
  return events.find(e => on(e) && now - (last[e] ?? -Infinity) >= SOUND_GAP_MS)
}
