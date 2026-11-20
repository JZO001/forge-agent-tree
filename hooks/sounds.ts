/**
 * The pane's sounds (plan 09, the user's request of 2026-11-19): sci-fi cues
 * for the session's events, each with a switch of its own under one switch for
 * them all. Only decisions here: which events a change of state raises, and
 * which one sounds now. register.tsx plays them.
 */
import type { AgentState, TreeAgent, TreeRun, TreeState } from '../types'
import { LIMIT_THRESHOLDS } from './format'
import type { LimitThresholds } from './format'
import { isMember, runEnded, runFailed } from './model'
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
/** How long a raised sound may wait for its turn (a more important one, the common gap); then it is let go. */
export const SOUND_WAIT_MS = 2000
/**
 * How far before the last hearing an agent or a run may have started and still
 * count as new: its own time is read when its event came, the hearing's at the
 * tick, and the two are not ordered to the millisecond.
 */
const FRESH_SLACK_MS = 1000
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
  /** When it was heard: what started since and has already ended still sounds. */
  at?: number
}

/** Whether the context or a limit stands at its red mark. */
export function isCritical(s: TreeState, thresholds: LimitThresholds = LIMIT_THRESHOLDS): boolean {
  const ctx = s.main.contextPercent
  if (ctx !== undefined && !s.main.contextEstimated && ctx >= CRITICAL_CONTEXT) return true
  return (s.main.limits ?? []).some(l => l.percent >= thresholds.alert)
}

/**
 * Whether the sounds hear an agent: not a row made up from an event no spawn has
 * named yet (`bare`), which may be the engine's own, unless a run took it in
 * (a stalled workflow agent's retry, `adoptStrays`).
 */
function audible(a: TreeAgent): boolean {
  return !a.bare || a.run !== undefined
}

/** What the sounds hear of a state, at `now`. */
export function heardOf(s: TreeState, thresholds?: LimitThresholds, now?: number): Heard {
  const agents: Record<string, AgentState> = {}
  for (const a of s.agents) if (audible(a)) agents[a.id] = a.state
  const runs: Record<string, boolean> = {}
  for (const r of s.runs ?? []) runs[r.id] = runEnded(r)
  return { agents, runs, busy: s.main.isBusy, advisor: s.advisor.total, critical: isCritical(s, thresholds), ...(now !== undefined ? { at: now } : {}) }
}

const ACTIVE: readonly AgentState[] = ['starting', 'running', 'waiting']

/** Whether something that started at `startedAt` is new since the last hearing. */
function freshSince(prev: Heard, startedAt: number): boolean {
  return prev.at !== undefined && startedAt >= prev.at - FRESH_SLACK_MS
}

/**
 * One thing a change of state tells: the event, and whom it is about, an agent
 * or a workflow run (neither for the main turn, an advisor call, the alert).
 * The sounds hear only the event; the notifications (notices.ts) also who.
 */
export type Change = { event: SoundEvent; agent?: TreeAgent; run?: TreeRun }

/**
 * What a change of state tells, one entry each. A workflow run's agents are
 * not heard starting or ending well (as the log does not tell of them), only
 * failing; the run's own end is. One that started since the last hearing and
 * has already ended (a subagent whose first request failed) tells how it ended;
 * one first seen long ended (the list found it) says nothing.
 */
export function heardChanges(prev: Heard, s: TreeState, thresholds?: LimitThresholds): Change[] {
  const out: Change[] = []
  for (const a of s.agents) {
    if (!audible(a)) continue
    const before = prev.agents[a.id]
    const member = isMember(s, a)
    if (before === undefined) {
      if (!member && ACTIVE.includes(a.state)) out.push({ event: 'spawn', agent: a })
      if (a.state === 'waiting') out.push({ event: 'waiting', agent: a })
      if (freshSince(prev, a.startedAt)) {
        if (a.state === 'failed') out.push({ event: 'failed', agent: a })
        if (a.state === 'done' && !member) out.push({ event: 'done', agent: a })
      }
      continue
    }
    if (before === a.state) continue
    if (a.state === 'done' && !member) out.push({ event: 'done', agent: a })
    if (a.state === 'failed') out.push({ event: 'failed', agent: a })
    if (a.state === 'waiting') out.push({ event: 'waiting', agent: a })
  }
  for (const r of s.runs ?? []) {
    const was = prev.runs[r.id]
    // A run heard at work that has now ended; one first seen ended only where it started since.
    if (!runEnded(r) || was === true || (was === undefined && !freshSince(prev, r.startedAt))) continue
    if (runFailed(s, r)) out.push({ event: 'failed', run: r })
    else if (r.end === 'completed' || r.end === undefined) out.push({ event: 'done', run: r })
  }
  if (prev.busy && !s.main.isBusy) out.push({ event: 'turn' })
  if (s.advisor.total > prev.advisor) out.push({ event: 'advisor' })
  if (!prev.critical && isCritical(s, thresholds)) out.push({ event: 'alert' })
  return out
}

/** The events a change of state sounds, each once, the most important first. */
export function soundEvents(prev: Heard, s: TreeState, thresholds?: LimitThresholds): SoundEvent[] {
  return soundEventsOf(heardChanges(prev, s, thresholds))
}

/** The events of what changed, each once, the most important first. */
export function soundEventsOf(changes: readonly Change[]): SoundEvent[] {
  return PRIORITY.filter(e => changes.some(c => c.event === e))
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

/** The sounds raised and not played yet, each with when it was raised. */
export type SoundQueue = Partial<Record<SoundEvent, number>>

/**
 * The sounds waiting their turn, and the one that sounds now (the review of
 * 2026-11-20: what the common gap or a more important sound held back was lost).
 * A raised event switched on waits, unless it sounded within its own gap (the
 * sound has just told of it); one that cannot sound within `SOUND_WAIT_MS` of
 * being raised is let go, so nothing sounds long after what it tells of.
 */
export function nextSound(
  queue: SoundQueue,
  raised: readonly SoundEvent[],
  on: (e: SoundEvent) => boolean,
  last: Readonly<Record<string, number>>,
  now: number,
): { queue: SoundQueue; play?: SoundEvent } {
  const waiting: SoundQueue = {}
  for (const e of PRIORITY) {
    const since = queue[e]
    if (since !== undefined && now - since <= SOUND_WAIT_MS && on(e)) waiting[e] = since
  }
  for (const e of raised) {
    if (!on(e) || now - (last[e] ?? -Infinity) < SOUND_GAP_MS) continue
    waiting[e] ??= now
  }
  const play = pickSound(
    PRIORITY.filter(e => waiting[e] !== undefined),
    on,
    last,
    now,
  )
  if (play === undefined) return { queue: waiting }
  const rest: SoundQueue = { ...waiting }
  delete rest[play]
  return { queue: rest, play }
}
