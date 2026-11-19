// Pure state functions of the agent tree. Every event the mod hears becomes
// one of these transformations, so they are tested without the engine.
//
// `$.agent.list()` is the authority on which agents exist and where they
// stand; the events add what the list does not carry (the last tool, the tool
// count, advisor calls, why a run ended). A node is never dropped because it
// left the list: a hook bypassed by another plugin loses detail, not agents.
import type { AgentState, EndReason, LogEntry, LogKind, LogSay, RunEnd, TreeAgent, TreeChoices, TreeLimit, TreeRun, TreeState } from '../types'
import { activity, duration, modelName, oneLine, seconds } from './format'

export const MAX_AGENTS = 60
export const MAX_LOG = 200
export const MAX_CALLS = 50
/** The workflow runs kept; the oldest ended ones with no agent left in the tree go first. */
export const MAX_RUNS = 20
/** A run with no notification and nothing working this long is taken as ended. */
export const RUN_SETTLE_MS = 120_000
/** An agent no spawn has named this long, seen while one run works, is taken as that run's (a stalled agent's retry). */
export const STRAY_MS = 5_000

const ACTIVE: ReadonlySet<AgentState> = new Set<AgentState>(['starting', 'running', 'waiting'])
const ENDED: ReadonlySet<AgentState> = new Set<AgentState>(['done', 'failed', 'stopped'])

export function isActive(a: TreeAgent): boolean {
  return ACTIVE.has(a.state)
}

export function isEnded(a: TreeAgent): boolean {
  return ENDED.has(a.state)
}

/** Something is working: the main turn or an agent. */
export function anyActive(s: TreeState): boolean {
  return s.main.isBusy || s.agents.some(isActive)
}

export function emptyTree(now: number): TreeState {
  return {
    startedAt: now,
    main: { tools: 0, isBusy: false },
    agents: [],
    advisor: { total: 0, calls: [] },
    log: [],
  }
}

/** After `/clear`: a new conversation, the same models. */
export function reset(s: TreeState, now: number): TreeState {
  const fresh = emptyTree(now)
  return {
    ...fresh,
    main: { ...fresh.main, model: s.main.model, effort: s.main.effort, contextWindow: s.main.contextWindow },
    advisor: { ...fresh.advisor, model: s.advisor.model },
  }
}

/**
 * After a session swap: nothing of another session is still at work here.
 * Agents the agent list does not show any more are stopped, the main turn idle.
 */
export function orphaned(s: TreeState, present: ReadonlySet<string>, now: number): TreeState {
  return {
    ...s,
    main: { ...s.main, isBusy: false },
    agents: s.agents.map(a => (isActive(a) && !present.has(a.id) ? { ...a, state: 'stopped', since: now, endedAt: now } : a)),
  }
}

export function effortText(effort: string | number | undefined): string | undefined {
  return effort === undefined ? undefined : String(effort)
}

export function toolCount(n: number): string {
  return `${n} tool${n === 1 ? '' : 's'}`
}

/**
 * Adds a log entry where its time puts it, newest first: an entry can come
 * later than what it tells of (a run's end the main took in after other
 * events, an advisor call logged when its request settled), and the log reads
 * in time order (the user's report of 2026-11-19).
 */
function withLog(s: TreeState, entry: LogEntry): TreeState {
  const at = s.log.findIndex(x => x.at <= entry.at)
  const log = at < 0 ? [...s.log, entry] : [...s.log.slice(0, at), entry, ...s.log.slice(at)]
  return { ...s, log: log.slice(0, MAX_LOG) }
}

function patchAgent(s: TreeState, id: string, change: (a: TreeAgent) => TreeAgent): TreeState {
  return { ...s, agents: s.agents.map(a => (a.id === id ? change(a) : a)) }
}

function labelOf(a: TreeAgent): string {
  return a.description || a.type || 'agent'
}

/** Who did something, for the log: an agent's description, or `main`. */
export function whoOf(s: TreeState, agentId: string | undefined): string {
  if (!agentId) return 'main'
  const a = s.agents.find(x => x.id === agentId)
  return a ? labelOf(a) : 'agent'
}

function sameModel(a: string, b: string): boolean {
  const x = modelName(a)
  const y = modelName(b)
  if (!x || !y) return a === b
  if (x.family !== y.family) return false
  // An alias (`opus`) carries no version: it matches any version of its family.
  return x.long === y.long || !/\d/.test(x.long) || !/\d/.test(y.long)
}

function placeholder(id: string, now: number): TreeAgent {
  return { id, description: '', type: 'agent', state: 'running', since: now, startedAt: now, tools: 0, bare: true }
}

export type Configured = { model?: string; advisorModel?: string; effort?: string }

/**
 * What the session says at its start: the main model, its effort as the
 * settings set it (each model request then says what it really asks), and the
 * advisor's model.
 */
export function configured(s: TreeState, c: Configured): TreeState {
  return {
    ...s,
    main: { ...s.main, model: s.main.model ?? c.model, effort: s.main.effort ?? c.effort },
    advisor: { ...s.advisor, model: c.advisorModel ?? s.advisor.model },
  }
}

export type SpawnFacts = {
  agentId: string
  parentId?: string
  description: string
  type: string
  name?: string
  model?: string
  background?: boolean
  fork?: boolean
  teammate?: boolean
  workflow?: boolean
  /** A workflow agent's run (`workflow.runId`); absent, or empty, for any other. */
  run?: string
  /** The Workflow tool call a workflow agent's run came from. */
  toolUseId?: string
}

export function spawned(s: TreeState, f: SpawnFacts, now: number): TreeState {
  const label = oneLine(f.description) || f.type || 'agent'
  const found = s.agents.find(a => a.id === f.agentId)
  // An agent's own events can come before its spawn settles (a workflow agent's
  // turn.start does): the made-up row it left is this agent, new, not resumed.
  const bare = found?.bare ? found : undefined
  const existing = bare ? undefined : found
  if (existing) {
    const resumed = patchAgent(s, f.agentId, a => ({
      ...a,
      state: 'starting',
      since: now,
      endedAt: undefined,
      endReason: undefined,
      description: a.description || label,
      model: f.model ?? a.model,
    }))
    return withLog(resumed, { at: now, kind: 'spawn', agentId: f.agentId, label, text: 'resumed', say: { phrase: 'resumed' } })
  }
  const agent: TreeAgent = {
    id: f.agentId,
    parentId: f.parentId,
    description: label,
    type: f.type,
    name: f.name,
    model: f.model,
    state: 'starting',
    since: now,
    startedAt: now,
    background: f.background || undefined,
    fork: f.fork || undefined,
    teammate: f.teammate || undefined,
    workflow: f.workflow || undefined,
    run: f.run || undefined,
    tools: 0,
    ...(bare ? { state: bare.state, since: bare.since, startedAt: bare.startedAt, tools: bare.tools, activity: bare.activity } : {}),
  }
  const agents = bare ? s.agents.map(a => (a.id === agent.id ? agent : a)) : [...s.agents, agent]
  // A workflow's agent joins its run's row; the run's start and end are logged, not each of its agents.
  if (agent.run !== undefined) return trimmed(joined({ ...s, agents }, agent.run, f, now))
  const model = modelName(f.model)?.long ?? f.type
  return trimmed(withLog({ ...s, agents }, { at: now, kind: 'spawn', agentId: f.agentId, label, text: `spawned · ${model}`, say: { phrase: 'spawned', value: model } }))
}

// ── workflow runs ───────────────────────────────────────────────────────

export function runOf(s: TreeState, id: string | undefined): TreeRun | undefined {
  return id === undefined ? undefined : s.runs?.find(r => r.id === id)
}

/** An agent drawn under a run's row: its run is known. */
export function isMember(s: TreeState, a: TreeAgent): boolean {
  return runOf(s, a.run) !== undefined
}

export function runEnded(r: TreeRun): boolean {
  return r.end !== undefined || r.settled === true
}

function patchRun(s: TreeState, id: string, change: (r: TreeRun) => TreeRun): TreeState {
  return { ...s, runs: (s.runs ?? []).map(r => (r.id === id ? change(r) : r)) }
}

function runLabel(r: TreeRun): string {
  return r.name || 'workflow'
}

/** A run's agents by where they stand, the ones the tree no longer holds included. */
export type RunTally = { total: number; active: number; waiting: number; done: number; failed: number; stopped: number }

export function runTally(s: TreeState, r: TreeRun): RunTally {
  const gone = r.gone ?? { done: 0, failed: 0, stopped: 0 }
  const t: RunTally = { total: gone.done + gone.failed + gone.stopped, active: 0, waiting: 0, done: gone.done, failed: gone.failed, stopped: gone.stopped }
  for (const a of s.agents) {
    if (a.run !== r.id) continue
    t.total += 1
    if (a.state === 'waiting') t.waiting += 1
    else if (a.state === 'done') t.done += 1
    else if (a.state === 'failed') t.failed += 1
    else if (a.state === 'stopped') t.stopped += 1
    else if (isActive(a)) t.active += 1
  }
  return t
}

export type RunFacts = {
  runId: string
  name?: string
  about?: string
  taskId?: string
  toolUseId?: string
  /** The agent that called the Workflow tool; absent for main. */
  callerId?: string
}

/** A run starts: its first sight logs it. A resumed run (the same id, a new call) opens again. */
function opened(s: TreeState, f: RunFacts, now: number): TreeState {
  const known = runOf(s, f.runId)
  if (known) {
    const again = runEnded(known)
    const next = patchRun(s, known.id, r => ({
      ...r,
      name: f.name ?? r.name,
      about: f.about ?? r.about,
      taskId: f.taskId ?? r.taskId,
      toolUseId: f.toolUseId ?? r.toolUseId,
      // A resumed run starts over: its time counts from this call.
      ...(again ? { end: undefined, settled: undefined, endedAt: undefined, startedAt: now } : {}),
    }))
    if (!again) return next
    const r = runOf(next, known.id)!
    return withLog(next, { at: now, kind: 'run', label: runLabel(r), text: 'started', say: { phrase: 'started' } })
  }
  const run: TreeRun = {
    id: f.runId,
    name: f.name,
    about: f.about,
    taskId: f.taskId,
    toolUseId: f.toolUseId,
    parentId: f.callerId,
    startedAt: now,
  }
  const runs = [...(s.runs ?? []), run]
  return withLog(trimRuns({ ...s, runs }), { at: now, kind: 'run', label: runLabel(run), text: 'started', say: { phrase: 'started' } })
}

/** The Workflow tool answered: the run is launched, under this id. */
export function runLaunched(s: TreeState, f: RunFacts, now: number): TreeState {
  if (!f.runId) return s
  return opened(s, f, now)
}

/** A workflow agent spawned: its run exists from now, and works again if it had been taken as ended. */
function joined(s: TreeState, runId: string, f: SpawnFacts, now: number): TreeState {
  const known = runOf(s, runId)
  // A run taken as ended works again: a later phase's agent started.
  if (known?.settled) return patchRun(s, runId, x => ({ ...x, settled: undefined, endedAt: undefined }))
  if (known) return s
  return opened(s, { runId, toolUseId: f.toolUseId || undefined, callerId: f.parentId }, now)
}

export type RunNotice = {
  taskId?: string
  toolUseId?: string
  /** `completed`, `failed`, `killed`, or another word. */
  status: string
  durationMs?: number
}

/**
 * The background tasks' notifications in a text the main conversation takes in:
 * `<task-notification>` blocks, each with its `<task-id>`, `<tool-use-id>`,
 * `<status>` and, in its `<usage>`, `<duration_ms>` (checked live, plan 05).
 */
export function taskNotices(text: string): RunNotice[] {
  const out: RunNotice[] = []
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = m[1] ?? ''
    const tag = (name: string): string | undefined => new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1]?.trim() || undefined
    const status = tag('status')
    if (!status) continue
    const ms = tag('duration_ms')
    out.push({ taskId: tag('task-id'), toolUseId: tag('tool-use-id'), status, durationMs: ms !== undefined && /^\d+$/.test(ms) ? Number(ms) : undefined })
  }
  return out
}

function endOf(status: string): RunEnd {
  if (status === 'failed') return 'failed'
  if (status === 'killed' || status === 'stopped') return 'killed'
  return 'completed'
}

/**
 * A run's notification arrived: it ended, how and after how long. Its agents
 * still marked at work are stopped (a stalled agent a retry replaced).
 */
export function runNoticed(s: TreeState, n: RunNotice, now: number): TreeState {
  const r = (s.runs ?? []).find(x => (n.taskId !== undefined && x.taskId === n.taskId) || (n.toolUseId !== undefined && x.toolUseId === n.toolUseId))
  if (!r || r.end !== undefined) return s
  const end = endOf(n.status)
  const endedAt = n.durationMs !== undefined ? Math.min(now, r.startedAt + n.durationMs) : now
  let next = patchRun(s, r.id, x => ({ ...x, end, endedAt, settled: undefined }))
  next = { ...next, agents: next.agents.map(a => (a.run === r.id && isActive(a) ? { ...a, state: 'stopped' as const, since: now, endedAt: now } : a)) }
  // Taken as ended before: logged then, not again.
  if (r.settled) return next
  return withLog(next, runEndLog(next, runOf(next, r.id)!, end, endedAt))
}

function runEndLog(s: TreeState, r: TreeRun, end: RunEnd, endedAt: number): LogEntry {
  const ms = Math.max(0, endedAt - r.startedAt)
  const label = runLabel(r)
  if (end === 'failed') return { at: endedAt, kind: 'run', label, text: 'failed', say: { phrase: 'failed' }, right: duration(ms), ms }
  if (end === 'killed') return { at: endedAt, kind: 'run', label, text: 'stopped', say: { phrase: 'stopped' }, right: duration(ms), ms }
  const total = runTally(s, r).total
  return { at: endedAt, kind: 'run', label, text: `done · × ${total}`, say: { phrase: 'runDone', value: total }, right: duration(ms), ms }
}

/** When something of the run last happened: its start, or the latest change of one of its agents. */
function lastSign(s: TreeState, r: TreeRun): number {
  return s.agents.reduce((t, a) => (a.run === r.id ? Math.max(t, a.endedAt ?? a.since) : t), r.startedAt)
}

/**
 * Runs whose notification never came: nothing of them works and nothing has
 * happened for `RUN_SETTLE_MS`, so they are taken as ended, at their last sign.
 */
export function settleRuns(s: TreeState, now: number): TreeState {
  let next = s
  for (const r of s.runs ?? []) {
    if (runEnded(r)) continue
    if (s.agents.some(a => a.run === r.id && isActive(a))) continue
    const last = lastSign(s, r)
    if (now - last < RUN_SETTLE_MS) continue
    next = patchRun(next, r.id, x => ({ ...x, settled: true, endedAt: last }))
    const failed = runTally(next, r).failed > 0
    next = withLog(next, runEndLog(next, runOf(next, r.id)!, failed ? 'failed' : 'completed', last))
  }
  return next
}

/**
 * An agent no spawn named (a stalled workflow agent's retry raises none), the
 * list never showed, that turned up after the run started and has been at it
 * for `STRAY_MS`: while exactly one run works, it is taken as that run's.
 */
export function adoptStrays(s: TreeState, now: number): TreeState {
  const working = (s.runs ?? []).filter(r => !runEnded(r))
  if (working.length !== 1) return s
  const { id: run, startedAt } = working[0]!
  // Only one that turned up while the run works, and still at it: rows from before
  // (the engine's own forks carry ids no list names too) are not the run's.
  const strays = s.agents.filter(a => a.bare && !a.listed && a.run === undefined && isActive(a) && a.startedAt >= startedAt && now - a.startedAt >= STRAY_MS)
  if (strays.length === 0) return s
  const ids = new Set(strays.map(a => a.id))
  return { ...s, agents: s.agents.map(a => (ids.has(a.id) ? { ...a, run, workflow: true } : a)) }
}

/** Keeps at most MAX_RUNS runs: the oldest ended ones with no agent left in the tree go first. */
function trimRuns(s: TreeState): TreeState {
  const runs = s.runs ?? []
  if (runs.length <= MAX_RUNS) return s
  const used = new Set(s.agents.map(a => a.run).filter((id): id is string => id !== undefined))
  const removable = runs.filter(r => runEnded(r) && !used.has(r.id)).sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0))
  const drop = new Set(removable.slice(0, runs.length - MAX_RUNS).map(r => r.id))
  return { ...s, runs: runs.filter(r => !drop.has(r.id)) }
}

export function toolCalled(
  s: TreeState,
  agentId: string | undefined,
  tool: string,
  input: Readonly<Record<string, unknown>>,
  now: number,
): TreeState {
  const what = activity(tool, input)
  if (!agentId) return { ...s, main: { ...s.main, tools: s.main.tools + 1, activity: what } }
  const known = s.agents.some(a => a.id === agentId)
  const base = known ? s : { ...s, agents: [...s.agents, placeholder(agentId, now)] }
  return patchAgent(base, agentId, a => ({
    ...a,
    tools: a.tools + 1,
    activity: what,
    ...(a.state === 'starting' || a.state === 'idle' ? { state: 'running' as const, since: now } : {}),
  }))
}

/** A prompt's first line, as the main row shows it; none for a background task's notification, which is no prompt of the person's. */
function promptLine(text: string): string | undefined {
  const first = text.split('\n').map(line => line.trim()).find(line => line.length > 0)
  return first && !first.startsWith('<task-notification') ? first.slice(0, 300) : undefined
}

/**
 * The person sent a prompt. One typed while a turn runs goes into that turn,
 * and no new turn starts (checked in a live session, 2026-11-19): the main row
 * shows it from now, not only from the next turn's start.
 */
export function prompted(s: TreeState, text: string): TreeState {
  const prompt = promptLine(text)
  return prompt === undefined || prompt === s.main.prompt ? s : { ...s, main: { ...s.main, prompt } }
}

export function turnStarted(s: TreeState, agentId: string | undefined, text: string, now: number): TreeState {
  if (!agentId) {
    // A background task's notification wakes main too: it keeps the prompt it had.
    const prompt = promptLine(text) ?? s.main.prompt
    return { ...s, main: { ...s.main, isBusy: true, turnStartedAt: now, activity: undefined, prompt } }
  }
  if (!s.agents.some(a => a.id === agentId)) return { ...s, agents: [...s.agents, placeholder(agentId, now)] }
  return patchAgent(s, agentId, a =>
    a.state === 'running' ? a : { ...a, state: 'running', since: now, endedAt: undefined, endReason: undefined },
  )
}

export type AdvisorUse = { startedAt: number; endedAt?: number }

export type StepFacts = {
  agentId?: string
  model?: string
  effort?: string
  advisor: readonly AdvisorUse[]
}

export function stepped(s: TreeState, f: StepFacts, now: number): TreeState {
  let next = s
  if (!f.agentId) {
    const before = next.main.model
    next = { ...next, main: { ...next.main, model: f.model ?? before, effort: f.effort ?? next.main.effort } }
    if (before && f.model && !sameModel(before, f.model)) {
      const text = `${modelName(before)?.long ?? before} → ${modelName(f.model)?.long ?? f.model}`
      next = withLog(next, { at: now, kind: 'model', label: 'main', text })
    }
  } else {
    const a = next.agents.find(x => x.id === f.agentId)
    if (a) {
      next = patchAgent(next, a.id, x => ({ ...x, model: f.model ?? x.model, effort: f.effort ?? x.effort }))
      if (a.model && f.model && !sameModel(a.model, f.model)) {
        const text = `${modelName(a.model)?.long ?? a.model} → ${modelName(f.model)?.long ?? f.model}`
        next = withLog(next, { at: now, kind: 'model', agentId: a.id, label: labelOf(a), text })
      }
    }
  }
  for (const use of f.advisor) {
    const ms = use.endedAt === undefined ? undefined : Math.max(0, use.endedAt - use.startedAt)
    const adv = next.advisor
    const calls = [...adv.calls, { at: use.startedAt, ms, by: f.agentId }].slice(-MAX_CALLS)
    next = {
      ...next,
      advisor: {
        ...adv,
        total: adv.total + 1,
        calls,
        fromMain: (adv.fromMain ?? 0) + (f.agentId === undefined ? 1 : 0),
        fromAgents: (adv.fromAgents ?? 0) + (f.agentId === undefined ? 0 : 1),
        timed: (adv.timed ?? 0) + (ms === undefined ? 0 : 1),
        totalMs: (adv.totalMs ?? 0) + (ms ?? 0),
        maxMs: Math.max(adv.maxMs ?? 0, ms ?? 0),
      },
    }
    if (f.agentId !== undefined) next = patchAgent(next, f.agentId, a => ({ ...a, advisorCalls: (a.advisorCalls ?? 0) + 1 }))
    const who = whoOf(next, f.agentId)
    next = withLog(next, {
      at: use.startedAt,
      kind: 'advisor',
      agentId: f.agentId,
      label: 'advisor',
      text: `called by ${who}`,
      say: { phrase: 'calledBy', value: who },
      right: ms === undefined ? undefined : seconds(ms),
      ms,
    })
  }
  return next
}

export type EndFacts = { agentId?: string; reason: EndReason }

export function turnCompleted(s: TreeState, f: EndFacts, now: number): TreeState {
  if (!f.agentId) return { ...s, main: { ...s.main, isBusy: false, turnEndedAt: now } }
  const a = s.agents.find(x => x.id === f.agentId)
  if (!a) return s
  // The list saw the end first: keep its record, add the reason, log nothing twice.
  if (isEnded(a)) {
    const state: AgentState = f.reason === 'answer' ? a.state : f.reason === 'aborted' ? 'stopped' : 'failed'
    return patchAgent(s, a.id, x => ({ ...x, state, endReason: f.reason }))
  }
  if (a.teammate && f.reason === 'answer') return patchAgent(s, a.id, x => ({ ...x, state: 'idle', since: now }))
  const state: AgentState = f.reason === 'answer' ? 'done' : f.reason === 'aborted' ? 'stopped' : 'failed'
  const ended = patchAgent(s, a.id, x => ({ ...x, state, since: now, endedAt: now, endReason: f.reason }))
  // A workflow's agent: its run's row counts it; only a failure is logged.
  if (isMember(s, a) && state !== 'failed') return ended
  const text = state === 'done' ? `done · ${toolCount(a.tools)}` : state === 'stopped' ? 'interrupted' : f.reason === 'refusal' ? 'refused' : 'error'
  const say: LogSay =
    state === 'done'
      ? { phrase: 'done', value: a.tools }
      : { phrase: state === 'stopped' ? 'interrupted' : f.reason === 'refusal' ? 'refused' : 'error' }
  const ms = now - a.startedAt
  return withLog(ended, { at: now, kind: state, agentId: a.id, label: labelOf(a), text, say, right: duration(ms), ms })
}

export type MeasureFacts = {
  percent?: number
  tokens?: number
  window?: number
  costUsd?: number
  hasUnknownPrice?: boolean
  limits?: TreeLimit[]
}

export function measured(s: TreeState, m: MeasureFacts, now: number): TreeState {
  const main = {
    ...s.main,
    contextPercent: m.percent ?? s.main.contextPercent,
    // A measured share ends the estimate; a measurement without one keeps it.
    contextEstimated: m.percent !== undefined ? undefined : s.main.contextEstimated,
    contextTokens: m.tokens ?? s.main.contextTokens,
    contextWindow: m.window ?? s.main.contextWindow,
    costUsd: m.costUsd ?? s.main.costUsd,
    hasUnknownPrice: m.hasUnknownPrice || undefined,
    limits: m.limits && m.limits.length > 0 ? m.limits : s.main.limits,
    limitsEstimated: m.limits && m.limits.length > 0 ? undefined : s.main.limitsEstimated,
  }
  const next = { ...s, main }
  if (m.percent === undefined) return next
  // Logged where the weather turns to storm (75%) and to red (90%).
  const level = m.percent >= 90 ? 90 : m.percent >= 75 ? 75 : 0
  const warned = s.main.warnedAt ?? 0
  if (level > warned) {
    return withLog({ ...next, main: { ...main, warnedAt: level } }, {
      at: now,
      kind: 'context',
      label: 'main',
      text: `context ${Math.round(m.percent)}%`,
      say: { phrase: 'context', value: Math.round(m.percent) },
      percent: m.percent,
    })
  }
  // Below the threshold again (a compaction): the next crossing is logged anew.
  if (level < warned) return { ...next, main: { ...main, warnedAt: level } }
  return next
}

export type TurnReading = { tokens: number; window: number; percent: number }

/**
 * The context read when a main turn ended: measured as any reading, and set
 * against the reading of the turn before, as token-weather's `last turn`.
 */
export function turnMeasured(s: TreeState, r: TurnReading, now: number): TreeState {
  const next = measured(s, { percent: r.percent, tokens: r.tokens, window: r.window }, now)
  const before = s.main.lastTurnTokens
  return {
    ...next,
    main: { ...next.main, lastTurnTokens: r.tokens, turnDelta: before === undefined ? undefined : r.tokens - before },
  }
}

export type ContextEstimate = { percent: number; tokens?: number; window?: number }

/**
 * The context's fill estimated before a response has measured the window (a
 * fresh session, a resumed one, one just compacted): drawn with `~`, never
 * logged, and replaced by the first measurement.
 */
export function estimatedContext(s: TreeState, c: ContextEstimate): TreeState {
  return {
    ...s,
    main: {
      ...s.main,
      contextPercent: c.percent,
      contextTokens: c.tokens ?? s.main.contextTokens,
      contextWindow: c.window ?? s.main.contextWindow,
      contextEstimated: true,
    },
  }
}

export type AdvisorSetting = { model?: string; off?: boolean }

/**
 * What the settings or the person's `/advisor` say of the advisor. A named
 * model turns it on; `off` clears the model; nothing known changes nothing,
 * so a model learnt from an agent's usage stays.
 */
export function advisorSet(s: TreeState, a: AdvisorSetting): TreeState {
  if (a.off) return { ...s, advisor: { ...s.advisor, model: undefined, off: true } }
  if (!a.model || (a.model === s.advisor.model && !s.advisor.off)) return s
  return { ...s, advisor: { ...s.advisor, model: a.model, off: undefined } }
}

/**
 * The limits an earlier session last knew, while this one has none: the
 * windows not yet reset, drawn with `~` until a response reports them.
 */
export function rememberedLimits(s: TreeState, saved: readonly TreeLimit[], now: number): TreeState {
  if ((s.main.limits ?? []).length > 0) return s
  const open = saved.filter(l => l.resetsAt !== undefined && Date.parse(l.resetsAt) > now)
  if (open.length === 0) return s
  return { ...s, main: { ...s.main, limits: open, limitsEstimated: true } }
}

/** What the choice panels offer, or what they asked for, set on the tree; `undefined` clears a field. */
export function withChoices(s: TreeState, patch: Partial<TreeChoices>): TreeState {
  return { ...s, choices: { ...(s.choices ?? {}), ...patch } }
}

/** Where an agent's effort stood before a message set it: its pin, and whether it was exempt. */
export type PinBefore = { pin?: string; exempt: boolean }

/**
 * The effort a message from the pane sets on its agent: a level becomes its
 * pin; `auto` removes the pin and exempts it, so its requests keep their own
 * level and the new-subagent effort leaves it alone. Also what stood before,
 * to put back when the message is not delivered.
 */
export function messagePin(c: TreeChoices | undefined, agentId: string, effort: string): { patch: Pick<TreeChoices, 'pins' | 'exempt'>; before: PinBefore } {
  const pins = { ...(c?.pins ?? {}) }
  const exempt = new Set(c?.exempt ?? [])
  const before: PinBefore = { exempt: exempt.has(agentId), ...(pins[agentId] !== undefined ? { pin: pins[agentId] } : {}) }
  if (effort === 'auto') {
    delete pins[agentId]
    exempt.add(agentId)
  } else pins[agentId] = effort
  return { patch: { pins, exempt: [...exempt] }, before }
}

/** The agent's effort as it stood before a message that was not delivered. */
export function pinBack(c: TreeChoices | undefined, agentId: string, before: PinBefore): Pick<TreeChoices, 'pins' | 'exempt'> {
  const pins = { ...(c?.pins ?? {}) }
  if (before.pin !== undefined) pins[agentId] = before.pin
  else delete pins[agentId]
  const exempt = (c?.exempt ?? []).filter(id => id !== agentId)
  return { pins, exempt: before.exempt ? [...exempt, agentId] : exempt }
}

/** A message the person sent an agent from the pane went out: a log row. */
export function messaged(s: TreeState, agentId: string, now: number): TreeState {
  const a = s.agents.find(x => x.id === agentId)
  return withLog(s, { at: now, kind: 'message', agentId, label: a ? labelOf(a) : agentId, text: 'message sent', say: { phrase: 'messaged' } })
}

/** What was read back after a /model or /effort the pane ran. */
export type Readback = {
  /** The settings menu's model row value: the model in use, as an alias. */
  modelSetting?: string
  /** The session model's id as an alias (`opus`, `sonnet[1m]`). */
  modelAlias?: string
  /** The effort saved for the session's model. */
  effortSaved?: string
  /** The effort the header shows: the last request's, or a command's own. */
  effortShown?: string
  /** The `advisorModel` setting: a model, or null where none is set (the advisor off). */
  advisor?: string | null
}

/**
 * Which pending switches a read-back shows have taken effect, and which are
 * given up: still pending longer than `limitMs` after they were asked for.
 */
export function pendingSettled(
  c: TreeChoices | undefined,
  r: Readback,
  now: number,
  limitMs: number,
): { modelDone: boolean; effortDone: boolean; advisorDone: boolean; givenUp: Array<{ command: 'model' | 'effort' | 'advisor'; value: string }> } {
  const model = c?.pendingModel
  const effort = c?.pendingEffort
  const advisor = c?.pendingAdvisor
  const modelDone = model !== undefined && (r.modelSetting === model || r.modelAlias === model)
  const effortDone = effort !== undefined && (r.effortSaved === effort || r.effortShown === effort)
  const advisorDone =
    advisor !== undefined &&
    r.advisor !== undefined &&
    (advisor === 'off' ? r.advisor === null : r.advisor !== null && (r.advisor === advisor || modelName(r.advisor)?.family === advisor))
  const late = c?.pendingSince !== undefined && now - c.pendingSince > limitMs
  const givenUp: Array<{ command: 'model' | 'effort' | 'advisor'; value: string }> = []
  if (late && model !== undefined && !modelDone) givenUp.push({ command: 'model', value: model })
  if (late && effort !== undefined && !effortDone) givenUp.push({ command: 'effort', value: effort })
  if (late && advisor !== undefined && !advisorDone) givenUp.push({ command: 'advisor', value: advisor })
  return { modelDone, effortDone, advisorDone, givenUp }
}

/**
 * The model a new subagent is given: the pane's choice, where a spawn takes
 * one. Not for a fork (it always inherits), a resumed run, a workflow agent
 * (whose keys are pinned), or with CLAUDE_CODE_SUBAGENT_MODEL forcing one.
 * None leaves the spawn as it is.
 */
export function spawnModel(c: TreeChoices | undefined, e: { fork?: boolean; resume?: unknown; workflow?: unknown }): string | undefined {
  if (!c?.agentModel || c.agentModelForced) return undefined
  if (e.fork || e.resume !== undefined || e.workflow !== undefined) return undefined
  return c.agentModel
}

/**
 * The effort a subagent's request goes with: the one it was given when it
 * started (its pin), else, for an agent new since the effort was chosen, the
 * choice, which becomes its pin. Only where the request carries a level:
 * never the main loop, a model without effort, or a number. `effort` absent
 * leaves the request as it is.
 */
export function stepEffort(c: TreeChoices | undefined, agentId: string | undefined, asked: unknown): { effort?: string; pin?: string } {
  if (!c || agentId === undefined || typeof asked !== 'string') return {}
  const pinned = c.pins?.[agentId]
  if (pinned !== undefined) return pinned === asked ? {} : { effort: pinned }
  if (c.agentEffort === undefined || (c.exempt ?? []).includes(agentId)) return {}
  return c.agentEffort === asked ? { pin: c.agentEffort } : { effort: c.agentEffort, pin: c.agentEffort }
}

/**
 * The model a running subagent's request goes with: the one the pane switched
 * it to, where that is not the model the request already names. None leaves
 * the request as it is.
 */
export function stepModel(c: TreeChoices | undefined, agentId: string | undefined, asked: string): string | undefined {
  if (agentId === undefined) return undefined
  const chosen = c?.runModels?.[agentId]
  if (chosen === undefined) return undefined
  const family = modelName(asked)?.family
  return family !== undefined && family === modelName(chosen)?.family && /\[1m\]/.test(asked) === /\[1m\]/.test(chosen) ? undefined : chosen
}

/** What the store keeps of a session: the subagent choices made in its pane, and when. */
export type SessionRecord = { agentModel?: string; agentEffort?: string; at: number }

/** A stored session record, or none where the value is not one. */
export function recordOf(value: unknown): SessionRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.at !== 'number') return undefined
  return {
    at: v.at,
    ...(typeof v.agentModel === 'string' ? { agentModel: v.agentModel } : {}),
    ...(typeof v.agentEffort === 'string' ? { agentEffort: v.agentEffort } : {}),
  }
}

/** The session records to delete: older than `maxAgeMs`, or past the newest `keep`. */
export function staleRecords(records: ReadonlyArray<{ key: string; at: number }>, now: number, maxAgeMs: number, keep: number): string[] {
  const newest = [...records].sort((a, b) => b.at - a.at)
  return newest.filter((r, i) => i >= keep || now - r.at > maxAgeMs).map(r => r.key)
}

/** The person changed the main model or its effort (`/model`, `/effort`). */
export function mainChanged(s: TreeState, c: { model?: string; effort?: string }): TreeState {
  return { ...s, main: { ...s.main, model: c.model ?? s.main.model, effort: c.effort ?? s.main.effort } }
}

export function compacted(s: TreeState, agentId: string | undefined, now: number): TreeState {
  return withLog(s, { at: now, kind: 'compact', agentId, label: whoOf(s, agentId), text: 'context compacted', say: { phrase: 'compacted' } })
}

/** One row of `$.agent.list()`, as much as the tree reads of it. */
export type ListedAgent = {
  id: string
  parentId?: string
  description: string
  type: string
  name?: string
  status: string
  label?: string
  startTime?: number
  model?: string
  effort?: string | number
  tokenCount?: number
  contextWindowSize?: number
  tokenSamples?: readonly number[]
  costUsd?: number
  teammate?: boolean
  /** The models its requests were answered by (`AgentInfo.usage`), an advisor's among them. */
  models?: readonly string[]
}

const RANK: Readonly<Record<string, number>> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

/**
 * The advisor's model as an agent's usage shows it: a model other than the
 * agent's own, ranking at or above it (an advisor must), the highest such.
 * Undefined where nothing tells it apart (an Opus agent with an Opus advisor).
 */
export function advisorFromUsage(own: string | undefined, models: readonly string[]): string | undefined {
  const mine = modelName(own)
  const floor = RANK[mine?.family ?? ''] ?? 0
  let best: string | undefined
  let bestRank = 0
  for (const id of models) {
    const m = modelName(id)
    const rank = RANK[m?.family ?? ''] ?? 0
    if (!m || rank === 0 || rank < floor || m.long === mine?.long) continue
    if (rank > bestRank) {
      best = id
      bestRank = rank
    }
  }
  return best
}

const STATUS: Readonly<Record<string, AgentState>> = {
  pending: 'starting',
  running: 'running',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

export function listed(s: TreeState, list: readonly ListedAgent[], now: number): TreeState {
  let next = s
  const present = new Set(list.map(x => x.id))
  for (const info of list) {
    const state = STATUS[info.status] ?? 'running'
    const a = next.agents.find(x => x.id === info.id)
    if (!a) {
      const agent: TreeAgent = {
        id: info.id,
        parentId: info.parentId,
        description: oneLine(info.description) || info.type,
        type: info.type,
        name: info.name,
        model: info.model,
        effort: effortText(info.effort),
        state,
        since: now,
        startedAt: info.startTime || now,
        endedAt: ENDED.has(state) ? now : undefined,
        teammate: info.teammate || undefined,
        tools: 0,
        label: info.label ? oneLine(info.label) : undefined,
        tokens: info.tokenCount,
        window: info.contextWindowSize,
        samples: info.tokenSamples ? [...info.tokenSamples] : undefined,
        costUsd: info.costUsd,
        listed: true,
      }
      next = { ...next, agents: [...next.agents, agent] }
      if (!ENDED.has(state)) {
        const model = modelName(info.model)?.long ?? info.type
        next = withLog(next, { at: now, kind: 'spawn', agentId: info.id, label: labelOf(agent), text: `found · ${model}`, say: { phrase: 'found', value: model } })
      }
      continue
    }
    // An ended run is final here: a resume comes back through `agent.spawn`.
    const moves = !ENDED.has(a.state) && state !== a.state
    next = patchAgent(next, a.id, x => ({
      ...x,
      listed: true,
      bare: undefined,
      parentId: info.parentId ?? x.parentId,
      description: x.description || oneLine(info.description) || info.type,
      type: x.type === 'agent' && info.type ? info.type : x.type,
      name: info.name ?? x.name,
      model: info.model ?? x.model,
      effort: effortText(info.effort) ?? x.effort,
      label: info.label ? oneLine(info.label) : x.label,
      tokens: info.tokenCount ?? x.tokens,
      window: info.contextWindowSize ?? x.window,
      samples: info.tokenSamples ? [...info.tokenSamples] : x.samples,
      costUsd: info.costUsd ?? x.costUsd,
      teammate: x.teammate || info.teammate || undefined,
      ...(moves ? { state, since: now, endedAt: ENDED.has(state) ? now : undefined } : {}),
    }))
    if (moves && state === 'waiting') {
      next = withLog(next, { at: now, kind: 'waiting', agentId: a.id, label: labelOf(a), text: 'waiting', say: { phrase: 'waiting' } })
    } else if (moves && ENDED.has(state)) {
      const kind: LogKind = state === 'done' ? 'done' : state === 'stopped' ? 'stopped' : 'failed'
      const text = kind === 'done' ? `done · ${toolCount(a.tools)}` : kind
      const say: LogSay = kind === 'done' ? { phrase: 'done', value: a.tools } : { phrase: kind }
      const ms = now - a.startedAt
      next = withLog(next, { at: now, kind, agentId: a.id, label: labelOf(a), text, say, right: duration(ms), ms })
    }
  }
  // An agent the list showed before and no longer does, still working by our
  // record, has ended: its row went. It stays in the tree.
  for (const a of next.agents) {
    if (a.listed && !present.has(a.id) && isActive(a)) {
      next = patchAgent(next, a.id, x => ({ ...x, state: 'done', since: now, endedAt: now }))
    }
  }
  // The settings may not name the advisor (`--advisor` in an interactive
  // session): an agent that asked it carries its model in its usage.
  if (!next.advisor.model) {
    for (const info of list) {
      if (!info.models || (next.agents.find(x => x.id === info.id)?.advisorCalls ?? 0) === 0) continue
      const model = advisorFromUsage(info.model, info.models)
      if (model) {
        next = { ...next, advisor: { ...next.advisor, model } }
        break
      }
    }
  }
  return trimmed(next)
}

/** Keeps at most MAX_AGENTS nodes: the oldest ended leaves go first. */
export function trimmed(s: TreeState): TreeState {
  if (s.agents.length <= MAX_AGENTS) return s
  const parents = new Set(s.agents.map(a => a.parentId).filter((id): id is string => id !== undefined))
  const removable = s.agents
    .filter(a => ENDED.has(a.state) && !parents.has(a.id))
    .sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0))
  const drop = new Set(removable.slice(0, s.agents.length - MAX_AGENTS).map(a => a.id))
  // A run keeps count of the agents it loses here.
  let runs = s.runs
  for (const a of s.agents) {
    if (!drop.has(a.id) || a.run === undefined || !runs?.some(r => r.id === a.run)) continue
    const key = a.state === 'failed' ? 'failed' : a.state === 'stopped' ? 'stopped' : 'done'
    runs = runs.map(r => {
      if (r.id !== a.run) return r
      const gone = r.gone ?? { done: 0, failed: 0, stopped: 0 }
      return { ...r, gone: { ...gone, [key]: gone[key] + 1 } }
    })
  }
  return { ...s, agents: s.agents.filter(a => !drop.has(a.id)), ...(runs ? { runs } : {}) }
}
