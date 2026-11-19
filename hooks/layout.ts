// The pane as data: rows of styled segments sized to the pane's columns and
// chosen to fit its rows. No engine access, so every width is tested alone.
import type { Lang, LogEntry, PickerId, TreeAgent, TreeChoices, TreeRun, TreeState, TreeUi, TreeView } from '../types'
import {
  FAMILY_COLOR,
  NAME_COLORS,
  PULSE_COLOR,
  TIME_COLOR,
  TITLE_COLOR,
  TITLE_TEXT,
  TRUNK_COLOR,
  ago,
  at,
  bar,
  brighter,
  clock,
  cost,
  cut,
  duration,
  EFFORT_LEVELS,
  effortName,
  effortShort,
  LIMIT_THRESHOLDS,
  limitColor,
  modelColor,
  modelName,
  percent,
  seconds,
  spark,
  tokenDelta,
  tokens,
  tokensFine,
  until,
  weatherFor,
  windowSize,
  width,
} from './format'
import { anyActive, isActive, isEnded, isMember, runEnded, runOf, runTally, stepModel, whoOf } from './model'
import type { LimitThresholds } from './format'
import { LANGS, wordsFor } from './words'
import type { OptionField, Words } from './words'

export type Seg = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  /** The light cell running along a bar: the pane keeps redrawing while one is drawn. */
  live?: true
  /**
   * A part that can be pressed, inside a row of text: the language sign, a
   * choice in a panel. Neighbouring parts with the same `key` are one Button.
   */
  press?: Press
  key?: string
  /** A link: drawn as the surface's `Link` (a terminal's OSC 8 span), the text its label. */
  href?: string
}

export type Press =
  | { kind: 'agent'; id: string }
  | { kind: 'main' }
  | { kind: 'finished' }
  | { kind: 'log' }
  | { kind: 'help' }
  /** Opens a choice panel, or closes it when it is the one open; `agentId` for a running agent's. */
  | { kind: 'picker'; id: PickerId; agentId?: string }
  /** Picks a value in a choice panel; the panel closes. */
  | { kind: 'choose'; id: PickerId; value: string }
  /** Closes the open choice panel, choosing nothing. */
  | { kind: 'close' }
  /** Opens the message panel for an agent at the pane's foot, or closes it when it is the one open. */
  | { kind: 'compose'; agentId: string }
  /** Opens a workflow run's row to show all of its agents, or closes it. */
  | { kind: 'run'; id: string }
  /** Opens the options page, or goes back from it. */
  | { kind: 'options' }
  /** Sets one of the mod's options (as `/config` does). */
  | { kind: 'option'; field: OptionField; value: boolean | number }

export type KeyButton = { key: string; hotkey: string; label: string; press: Press }
export type KeyItem = { text: string } | KeyButton

export type Row =
  /** `covered`: a line a field above draws (its second): the row holds its edges for measuring, nothing more is drawn for it. */
  | { kind: 'text'; segs: Seg[]; covered?: true }
  | { kind: 'press'; key: string; press: Press; segs: Seg[] }
  | { kind: 'keys'; items: KeyItem[] }
  /**
   * A text field (the message panel's) between the frame's edges: `segs` are
   * the edges with the field's room between them as spaces, so the row is
   * measured and drawn as text where no field can be; `agentId` is whom it
   * writes to.
   */
  | { kind: 'input'; key: string; agentId: string; value?: string; label: string; lines: number; room: number; segs: Seg[] }

export type Mode = 'narrow' | 'normal' | 'wide'

export type LayoutOptions = {
  cols: number
  /** The rows the pane's body shows; undefined draws everything. */
  rows?: number
  placement?: string
  now: number
  frame: number
  animate: boolean
  /** How many log rows the normal and wide views show (the narrow one at most one); 0 hides the log. Five by default. */
  logRows?: number
  /** Where the limit bars turn yellow and red; 50% and 80% by default. */
  limits?: LimitThresholds
  /** What the person had typed into the message panel, given back when it opens again. */
  draft?: string
  /** The mod's options as in effect, for the options page; their defaults when absent. */
  settings?: Settings
}

/** The mod's options as in effect, and which of them a policy locks (shown with no buttons). */
export type Settings = { values: Record<OptionField, boolean | number>; locked?: readonly OptionField[] }

/** The options' defaults, as plugin.json declares them. */
export const DEFAULT_SETTINGS: Settings['values'] = {
  openOnStart: true,
  animate: true,
  columns: 56,
  logRows: 5,
  limitWarnAt: 50,
  limitAlertAt: 80,
  bandLine: true,
  advisorSound: false,
  autoUpdate: true,
}

/** The options page's rows, in this order (the language follows them). */
export const OPTION_ORDER: readonly OptionField[] = ['openOnStart', 'animate', 'columns', 'logRows', 'limitWarnAt', 'limitAlertAt', 'bandLine', 'advisorSound', 'autoUpdate']

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
/** The mod's repository, shown in the help view. */
export const REPO_URL = 'https://github.com/JZO001/forge-agent-tree'
export const KEY_GAP = 2
/** The log rows a view shows by default; the narrow one never more than one. */
const LOG_ROWS = 5
/** A flexible part is cut down to this before the right side is dropped. */
const MIN_FLEX = 6
/** In a short pane the header gives way first, so the tree keeps this many rows. */
const MIN_TREE = 4
/** A bar's fill this long or longer gets the light that runs along it. */
const SHIMMER_MIN = 3
/** Frames the trunk's pulse rests at the bottom before it starts again from `main`. */
const PULSE_REST = 3

type Part = Seg & { flex?: boolean }
/**
 * How much of each agent a short pane keeps: 0 everything; 1 no command lines;
 * 2 the status line only for waiting and failed agents; 3 one line an agent.
 */
type Detail = 0 | 1 | 2 | 3

export function modeOf(cols: number): Mode {
  if (cols < 44) return 'narrow'
  return cols >= 72 ? 'wide' : 'normal'
}

/** Whether a drawn pane holds a light running along a bar, so the ticker keeps it moving while idle. */
export function hasLiveCell(rows: readonly Row[]): boolean {
  return rows.some(r => r.kind !== 'keys' && r.segs.some(s => s.live === true))
}

export function isButton(item: KeyItem): item is KeyButton {
  return 'hotkey' in item
}

/** The cells a row takes; a hotkey Button draws as `f: label`. */
export function rowWidth(row: Row): number {
  if (row.kind === 'keys') {
    return row.items.reduce(
      (w, item, i) => w + (i > 0 ? KEY_GAP : 0) + (isButton(item) ? width(item.hotkey) + 2 + width(item.label) : width(item.text)),
      0,
    )
  }
  return sum(row.segs)
}

function sum(parts: readonly Seg[]): number {
  return parts.reduce((n, p) => n + width(p.text), 0)
}

function plain(p: Part): Seg {
  const seg: Seg = { text: p.text }
  if (p.color !== undefined) seg.color = p.color
  if (p.dim) seg.dim = true
  if (p.bold) seg.bold = true
  if (p.live) seg.live = true
  if (p.press) seg.press = p.press
  if (p.key !== undefined) seg.key = p.key
  if (p.href !== undefined) seg.href = p.href
  return seg
}

function attempt(left: readonly Part[], right: readonly Part[], cols: number): Part[] | undefined {
  const rightCells = right.length > 0 ? sum(right) + 1 : 0
  const at = left.findIndex(p => p.flex)
  const room = cols - rightCells - sum(left.filter(p => !p.flex))
  if (at < 0) return room >= 0 ? [...left] : undefined
  const flex = left[at]!
  const cells = width(flex.text)
  if (cells <= room) return [...left]
  if (room < Math.min(cells, MIN_FLEX)) return undefined
  const out = [...left]
  out[at] = { ...flex, text: cut(flex.text, room) }
  return out
}

function hardCut(parts: readonly Part[], cols: number): Part[] {
  const out: Part[] = []
  let used = 0
  for (const p of parts) {
    const cells = width(p.text)
    if (used + cells <= cols) {
      out.push(p)
      used += cells
      continue
    }
    if (cols - used > 0) out.push({ ...p, text: cut(p.text, cols - used) })
    break
  }
  return out
}

/**
 * `left … right` on `cols` cells: the flexible part is cut first, then the
 * right side dropped, then the left cut hard. `pad` fills the row, so a
 * focused row is highlighted across the pane.
 */
export function fit(left: readonly Part[], right: readonly Part[], cols: number, pad = false): Seg[] {
  let l = attempt(left, right, cols)
  let r: readonly Part[] = right
  if (!l) {
    r = []
    l = attempt(left, [], cols) ?? hardCut(left, cols)
  }
  const gap = cols - sum(l) - sum(r)
  const segs = l.map(plain)
  if (r.length > 0) segs.push({ text: ' '.repeat(Math.max(1, gap)) }, ...r.map(plain))
  else if (pad && gap > 0) segs.push({ text: ' '.repeat(gap) })
  return segs.filter(s => s.text.length > 0)
}

function text(segs: Seg[]): Row {
  return { kind: 'text', segs }
}

function sep(cols: number): Row {
  return text([{ text: '─'.repeat(cols), dim: true }])
}

function spin(o: LayoutOptions): string {
  return o.animate ? SPINNER[o.frame % SPINNER.length]! : '●'
}

// ── header ──────────────────────────────────────────────────────────────

/** The first right side that fits beside `left`, or none. */
function firstFit(left: readonly Part[], candidates: readonly (readonly Part[])[], cols: number): Part[] {
  for (const right of candidates) {
    if (right.length === 0 || sum(left) + 1 + sum(right) <= cols) return [...right]
  }
  return []
}

/**
 * A bar's parts in `color`: with motion on (`motion`, the frame; idle too)
 * and a fill of at least three cells, one cell of the fill, a shade lighter,
 * runs along it from left to right, then starts again at the left (never
 * right to left: the user's rule); the rest of the bar dim.
 */
function barParts(fraction: number, cells: number, color: string | undefined, motion: number | undefined): Part[] {
  const b = bar(fraction, cells)
  const full = b.fill.replace(/[^█]/g, '').length
  const parts: Part[] = []
  if (motion !== undefined && full >= SHIMMER_MIN) {
    const at = motion % full
    parts.push({ text: '█'.repeat(at), color }, { text: '█', color: brighter(color), live: true }, { text: '█'.repeat(full - at - 1), color })
  } else {
    parts.push({ text: '█'.repeat(full), color })
  }
  parts.push({ text: b.fill.slice(full), color }, { text: b.rest, dim: true })
  return parts.filter(p => p.text.length > 0)
}

/**
 * The context row: the weather sign, bar and share, then as token-weather
 * shows them the tokens over the window and the change over the last turn.
 * What does not fit goes in that order from the end: `last turn`, the change,
 * the tokens. Absent while the window's fill is unknown.
 */
function contextRow(s: TreeState, mode: Mode, cols: number, motion: number | undefined, w: Words, gauge: Gauge): Seg[] | undefined {
  const p = s.main.contextPercent
  if (p === undefined) return undefined
  const { icon, color } = weatherFor(p)
  const guess = s.main.contextEstimated === true
  // The weather sign right before the bar; the room up to the column where the
  // limit bars start goes between `ctx` and the sign (the user's request).
  const lead = Math.max(1, gauge.ctxAt - width(CTX_LABEL) - width(icon) - 1)
  const left: Part[] = [
    { text: CTX_LABEL, dim: true },
    { text: ' '.repeat(lead) },
    { text: `${icon} `, color },
    ...barParts(p / 100, mode === 'narrow' ? 6 : mode === 'wide' ? 20 : 10, color, motion),
    { text: gauge.share === undefined ? percent(p, guess) : percent(p, guess).trim().padStart(gauge.share), color, bold: true },
  ]
  const used = s.main.contextTokens
  const window = s.main.contextWindow
  const amount: Part | undefined =
    used !== undefined && window ? { text: `${guess ? '~' : ''}${tokensFine(used)} / ${windowSize(window)}` } : undefined
  const delta = !guess && s.main.turnDelta !== undefined ? tokenDelta(s.main.turnDelta) : undefined
  const candidates: Part[][] = []
  if (amount && delta) {
    candidates.push([amount, { text: '  ' }, { text: `${delta} ${w.lastTurn}`, dim: true }])
    candidates.push([amount, { text: '  ' }, { text: delta, dim: true }])
  }
  if (amount) candidates.push([amount])
  candidates.push([])
  return fit(left, firstFit(left, candidates, cols), cols)
}

/**
 * The main model and effort, each led by a `▾` that opens its panel
 * (`▾Opus 5.5`, `▾xhigh`), as the language sign is (`▾en`); a change the pane
 * asked for shows as `→ Sonnet` until it has taken effect. A model a policy
 * locks has no `▾`. The cost on the right, as fits.
 */
function modelRow(s: TreeState, cols: number, w: Words): Seg[] {
  const model = modelName(s.main.model)
  const color = modelColor(s.main.model)
  const effort = effortName(s.main.effort)
  const c = s.choices ?? {}
  const modelSign: Partial<Part> = c.modelLocked ? {} : { press: { kind: 'picker', id: 'model' }, key: 'picker:model' }
  const effortSign: Partial<Part> = { press: { kind: 'picker', id: 'effort' }, key: 'picker:effort' }
  const left: Part[] = [{ text: '● ', color }]
  if (!c.modelLocked) left.push({ text: '▾', color: TITLE_COLOR, ...modelSign })
  left.push({ text: model?.long ?? 'main', color, bold: true, ...modelSign })
  if (c.pendingModel) left.push({ text: ` → ${modelChoiceLabel(c.pendingModel, w)}`, color: TITLE_COLOR, ...modelSign })
  left.push({ text: ' · ', dim: true }, { text: '▾', color: TITLE_COLOR, ...effortSign })
  left.push(effort ? { text: effort, ...effortSign } : { text: w.effortWord, dim: true, ...effortSign })
  if (c.pendingEffort) left.push({ text: ` → ${effortName(c.pendingEffort) ?? c.pendingEffort}`, color: TITLE_COLOR, ...effortSign })
  const spent = cost(s.main.costUsd, s.main.hasUnknownPrice)
  return fit(left, firstFit(left, [spent ? [{ text: spent, dim: true }] : [], []], cols), cols)
}

const MODEL_NAMES: Readonly<Record<string, string>> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', best: 'Best', opusplan: 'Opus Plan' }

/** How a model panel names a `/model` alias: `Opus`, `Sonnet 1M`, `Opus Plan`, `Default`. */
export function modelChoiceLabel(alias: string, w: Words): string {
  if (alias === 'default') return w.defaultModel
  const m = /^([a-z]+)(\[1m\])?$/.exec(alias)
  if (!m) return alias
  return `${MODEL_NAMES[m[1]!] ?? alias}${m[2] ? ' 1M' : ''}`
}

/** What `/model` offers when the settings menu cannot be read. */
const FALLBACK_OFFER = ['default', 'opus', 'sonnet', 'haiku']

/** A model id as the `/model` alias of its family: `claude-opus-5-5[1m]` → `opus[1m]`. */
export function aliasOf(model: string | undefined): string | undefined {
  const m = modelName(model)
  if (!m || m.family === 'other') return undefined
  return `${m.family}${/\[1m\]$/i.test(model ?? '') ? '[1m]' : ''}`
}

/** The session's window first, then the week's, then any other. */
function limitOrder(kind: string): number {
  if (kind === 'five_hour') return 0
  if (kind === 'seven_day') return 1
  return 2
}

/** `session` / `all` (every model's use; narrow: `5h` / `7d`, which are times and drawn so), or a gateway's own name. */
function limitLabel(kind: string, mode: Mode, w: Words): { text: string; isTime: boolean } {
  if (kind === 'five_hour') return mode === 'narrow' ? { text: w.fiveHour, isTime: true } : { text: w.session, isTime: false }
  if (kind === 'seven_day') return mode === 'narrow' ? { text: w.sevenDay, isTime: true } : { text: w.allModels, isTime: false }
  return { text: kind.replace(/_/g, ' '), isTime: false }
}

/**
 * The plan's usage, a row a window: the session's (5 hours) and the week's,
 * as Claude Desktop shows them: a bar and the share in traffic-light colors,
 * then when it resets, the clock time and how long until, in the time color.
 * Absent while no response has reported the limits (or off a subscription).
 */
function limitRows(s: TreeState, mode: Mode, cols: number, now: number, motion: number | undefined, w: Words, gauge: Gauge, thresholds?: LimitThresholds): HeadRow[] {
  const limits = [...(s.main.limits ?? [])].sort((a, b) => limitOrder(a.kind) - limitOrder(b.kind))
  return limits.map(l => {
    const label = limitLabel(l.kind, mode, w)
    const color = limitColor(l.percent, thresholds)
    const left: Part[] = [
      { text: label.text, ...(label.isTime ? { color: TIME_COLOR } : { dim: true }) },
      { text: ' '.repeat(Math.max(1, gauge.limitAt - width(label.text))) },
      ...barParts(l.percent / 100, mode === 'narrow' ? 6 : mode === 'wide' ? 20 : 10, color, motion),
      { text: gauge.share === undefined ? percent(l.percent, s.main.limitsEstimated === true) : percent(l.percent, s.main.limitsEstimated === true).trim().padStart(gauge.share), color, bold: true },
    ]
    const resets = l.resetsAt ? Date.parse(l.resetsAt) : Number.NaN
    const right: Part[][] = []
    if (!Number.isNaN(resets)) {
      if (resets > now) {
        // When it resets, the day by its full name (`péntek 13:10`, the user's
        // request), then how long until; with little room the word `resets` goes
        // first, then the countdown, then the day's full name; the countdown alone last.
        const left_: Part = { text: w.in(until(resets - now, w.lang)), color: TIME_COLOR }
        const long: Part = { text: at(resets, now, w.lang, true), color: TIME_COLOR }
        const short: Part = { text: at(resets, now, w.lang), color: TIME_COLOR }
        const dot: Part = { text: ' · ', dim: true }
        right.push([{ text: w.resets, dim: true }, long, dot, left_])
        right.push([long, dot, left_])
        right.push([short, dot, left_])
        right.push([long])
        right.push([short])
        right.push([left_])
      } else {
        // Past its reset, until the next response brings the new window.
        right.push([{ text: w.resets, dim: true }, { text: w.now, color: TIME_COLOR }])
      }
    }
    right.push([])
    const stay = l.kind === 'five_hour' ? 6 : l.kind === 'seven_day' ? 4 : 3.5
    return { row: text(fit(left, firstFit(left, right, cols), cols)), stay }
  })
}

type TeamEntry = { key: string; title: string; color?: string; count: number }

/** The models at work this session, the main one first, by family. */
export function team(s: TreeState): TeamEntry[] {
  const entries: TeamEntry[] = []
  const add = (id: string | undefined): void => {
    const m = modelName(id)
    if (!m) return
    const key = m.family === 'other' ? m.long : m.family
    const found = entries.find(e => e.key === key)
    if (found) found.count += 1
    else entries.push({ key, title: m.family === 'other' ? m.long : m.long.split(' ')[0]!, color: FAMILY_COLOR[m.family], count: 1 })
  }
  add(s.main.model)
  for (const a of s.agents) add(a.model)
  return entries
}

function teamRow(s: TreeState, mode: Mode, cols: number, w: Words): Seg[] {
  const entries = team(s)
  const build = (short: boolean): Part[] => {
    const parts: Part[] = short ? [] : [{ text: w.team, dim: true }]
    const gap = short ? ' ' : '  '
    for (const e of entries) {
      if (parts.length > 0) parts.push({ text: gap })
      parts.push({ text: `${short ? e.title[0] : e.title} × ${e.count}`, color: e.color })
    }
    if (s.advisor.total > 0) {
      if (parts.length > 0) parts.push({ text: gap })
      parts.push({ text: `◆ × ${s.advisor.total}`, color: FAMILY_COLOR.fable })
    }
    return parts
  }
  const long = build(mode === 'narrow')
  return fit(sum(long) <= cols ? long : build(true), [], cols)
}

type AdvisorStats = { main: number; agents: number; avg?: number; max?: number; total?: number }

/** Who asked the advisor and how long its calls took; from the running counts, else from the calls kept. */
function advisorStats(s: TreeState): AdvisorStats {
  const adv = s.advisor
  const timedCalls = adv.calls.filter(c => c.ms !== undefined)
  const timed = adv.timed ?? timedCalls.length
  const totalMs = adv.totalMs ?? timedCalls.reduce((n, c) => n + (c.ms ?? 0), 0)
  const maxMs = adv.maxMs ?? timedCalls.reduce((n, c) => Math.max(n, c.ms ?? 0), 0)
  return {
    main: adv.fromMain ?? adv.calls.filter(c => c.by === undefined).length,
    agents: adv.fromAgents ?? adv.calls.filter(c => c.by !== undefined).length,
    ...(timed > 0 ? { avg: totalMs / timed, max: maxMs, total: totalMs } : {}),
  }
}

/**
 * The advisor's block under the team row. Its first row: the model (or
 * `on` while no source names it) and how many calls, by whom; its second, the
 * last call (who, how long ago, how long) and the calls' average length. The
 * second row gives way first in a short pane.
 */
function advisorRows(s: TreeState, mode: Mode, cols: number, now: number, w: Words): HeadRow[] {
  const adv = s.advisor
  const c = s.choices ?? {}
  // `▾` before the name opens the advisor panel; none where the environment turns the advisor off.
  const sign: Partial<Part> = c.advisorLocked ? {} : { press: { kind: 'picker', id: 'advisor' }, key: 'picker:advisor' }
  const lead: Part[] = [{ text: '◆ ', color: FAMILY_COLOR.fable }, ...(c.advisorLocked ? [] : [{ text: '▾', color: TITLE_COLOR, ...sign }])]
  const pending: Part[] = c.pendingAdvisor
    ? [{ text: ` → ${c.pendingAdvisor === 'off' ? w.offLabel : modelChoiceLabel(c.pendingAdvisor, w)}`, color: TITLE_COLOR, ...sign }]
    : []
  // Off, or never named nor called: one row, so it can be turned on; it gives way first unless it was in use.
  if (adv.off || (!adv.model && adv.total === 0)) {
    const off: Part[] = [...lead, { text: 'advisor', color: FAMILY_COLOR.fable, ...sign }, ...pending, { text: w.off, dim: true }]
    const stay = adv.off || adv.total > 0 || c.pendingAdvisor ? 5 : 1.5
    return [{ row: text(fit(off, adv.total > 0 ? [{ text: w.callsBefore(adv.total), dim: true }] : [], cols)), stay }]
  }
  const am = modelName(adv.model)
  const color = FAMILY_COLOR[am?.family ?? 'fable']
  const stats = advisorStats(s)
  const total = adv.total
  const calls = w.calls(total)

  const left: Part[] = [...lead]
  if (am) left.push({ text: am.long, color, bold: true, ...sign }, ...pending, ...(mode === 'narrow' ? [] : [{ text: ' advisor', dim: true }]))
  else left.push({ text: 'advisor', color, ...sign }, ...pending, { text: w.on, dim: true })
  const right: Part[][] = []
  if (total === 0) right.push([{ text: mode === 'narrow' ? w.noCalls : w.noCallsYet, dim: true }])
  else {
    const split: Part[] = [{ text: w.split(stats.main, stats.agents), dim: true }]
    const thisTurn = s.main.turnStartedAt === undefined ? 0 : adv.calls.filter(c => c.at >= (s.main.turnStartedAt ?? 0)).length
    if (mode === 'wide' && thisTurn > 0) right.push([{ text: calls }, ...split, { text: w.thisTurn(thisTurn), dim: true }])
    if (mode !== 'narrow') right.push([{ text: calls }, ...split])
    right.push([{ text: calls }])
  }
  right.push([])
  const rows: HeadRow[] = [{ row: text(fit(left, firstFit(left, right, cols), cols)), stay: 5 }]

  const last = adv.calls[adv.calls.length - 1]
  if (!last) return rows
  const when: Part[] = [{ text: ago(now - last.at, w.lang), color: TIME_COLOR }]
  if (last.ms !== undefined) when.push({ text: ' · ', dim: true }, { text: seconds(last.ms, w.lang), color: TIME_COLOR })
  const timing: Part[][] = []
  if (stats.avg !== undefined) {
    const avg: Part[] = [{ text: w.avg, dim: true }, { text: seconds(stats.avg, w.lang), color: TIME_COLOR }]
    if (mode === 'wide') {
      timing.push([
        ...avg,
        { text: w.max, dim: true },
        { text: seconds(stats.max ?? 0, w.lang), color: TIME_COLOR },
        { text: w.total, dim: true },
        { text: seconds(stats.total ?? 0, w.lang), color: TIME_COLOR },
      ])
    }
    timing.push(avg)
  }
  timing.push([])
  const second: Part[] =
    mode === 'narrow'
      ? [{ text: '  ' }, ...when]
      : [{ text: w.lastCall, dim: true }, { text: whoOf(s, last.by), dim: true, flex: true }, { text: ' · ', dim: true }, ...when]
  rows.push({ row: text(fit(second, firstFit(second, timing, cols), cols)), stay: 2 })
  return rows
}

/**
 * The pane's name; at its end, given `lang`, the language sign: `▾en`, three
 * cells that open the language panel.
 */
/**
 * What new subagents get, this session: `agents  model: ▾auto   effort: ▾low`.
 * Each `▾` opens its panel. A model the environment forces shows as such, with
 * no `▾`. A choice keeps the row in a short pane (a choice costs or saves
 * money); `auto` gives way early.
 */
function agentsRow(s: TreeState, mode: Mode, cols: number, w: Words): HeadRow {
  const c = s.choices ?? {}
  const modelSign: Partial<Part> = { press: { kind: 'picker', id: 'agentModel' }, key: 'picker:agentModel' }
  const effortSign: Partial<Part> = { press: { kind: 'picker', id: 'agentEffort' }, key: 'picker:agentEffort' }
  const model: Part[] = c.agentModelForced
    ? [{ text: `${modelName(c.agentModelForced)?.long ?? c.agentModelForced} ${w.forced}`, color: modelColor(c.agentModelForced) }]
    : [
        { text: '▾', color: TITLE_COLOR, ...modelSign },
        c.agentModel
          ? { text: modelChoiceLabel(c.agentModel, w), color: modelColor(c.agentModel), bold: true, ...modelSign }
          : { text: w.auto, dim: true, ...modelSign },
      ]
  const effort: Part[] = [
    { text: '▾', color: TITLE_COLOR, ...effortSign },
    c.agentEffort ? { text: effortName(c.agentEffort) ?? c.agentEffort, bold: true, ...effortSign } : { text: w.auto, dim: true, ...effortSign },
  ]
  const left: Part[] =
    mode === 'narrow'
      ? [{ text: `${w.agents} `, dim: true }, ...model, { text: ' · ', dim: true }, ...effort]
      : [{ text: w.agents, dim: true }, { text: '  ' }, { text: w.modelLabel, dim: true }, ...model, { text: '   ' }, { text: w.effortLabel, dim: true }, ...effort]
  return { row: text(fit(left, [], cols)), stay: c.agentModel || c.agentEffort ? 6.5 : 2.5 }
}

function titleRow(cols: number, lang?: Lang): Row {
  const press: Press = { kind: 'picker', id: 'lang' }
  const sign: Part[] =
    lang === undefined
      ? []
      : [
          { text: '▾', color: TITLE_COLOR, press, key: 'picker:lang' },
          { text: lang, press, key: 'picker:lang' },
        ]
  return text(fit([{ text: TITLE_TEXT, bold: true, color: TITLE_COLOR }], sign, cols))
}

/** A header row and how late it gives way in a short pane: higher stays longer; `gap`, an empty row between its groups. */
type HeadRow = { row: Row; stay: number; gap?: true }

/**
 * An empty row parting the header's groups (the user's request of 2026-11-19):
 * after the title, after the advisor, before the team. They give way first in
 * a short pane (`stay` under every row's).
 */
function gapRow(stay: number): HeadRow {
  return { row: text([{ text: ' ' }]), stay, gap: true }
}

/** The header's rows as drawn: no empty row first, last, or right after another; none at all without `gaps`. */
function tidy(rows: readonly HeadRow[], gaps = true): Row[] {
  const out: HeadRow[] = []
  for (const r of rows) {
    if (r.gap && (!gaps || out.length === 0 || out[out.length - 1]!.gap)) continue
    out.push(r)
  }
  while (out.length > 0 && out[out.length - 1]!.gap) out.pop()
  return out.map(r => r.row)
}

const CTX_LABEL = 'ctx'

/**
 * Where the header's bars start and how wide their shares are, so the context
 * bar and the limit bars begin in one column and their shares end in one (the
 * user's request of 2026-11-19): the column after the widest of `ctx` with its
 * sign (room for an emoji included) and the limit labels; the share as wide as
 * the widest of them, a space before it.
 */
type Gauge = { ctxAt: number; limitAt: number; share?: number }

function gaugeOf(s: TreeState, mode: Mode, w: Words): Gauge {
  const limits = s.main.limits ?? []
  const labels = limits.reduce((n, l) => Math.max(n, width(limitLabel(l.kind, mode, w).text) + 1), 0)
  // `ctx`, a space, the sign with its emoji room (two cells), a space
  const ctx = width(CTX_LABEL) + 1 + 2 + 1
  const p = s.main.contextPercent
  const shares = [
    ...(p === undefined ? [] : [percent(p, s.main.contextEstimated === true).trim()]),
    ...limits.map(l => percent(l.percent, s.main.limitsEstimated === true).trim()),
  ]
  // The narrow view keeps its room: no common column there (its limit labels are two cells).
  if (mode === 'narrow') return { ctxAt: ctx, limitAt: labels }
  const at = Math.max(ctx, labels)
  return { ctxAt: at, limitAt: at, share: shares.reduce((n, t) => Math.max(n, width(t) + 1), 4) }
}

function header(s: TreeState, mode: Mode, cols: number, now: number, motion: number | undefined, w: Words, thresholds?: LimitThresholds): HeadRow[] {
  // Drawn: title, model, context, the advisor, the limits, the team.
  // In a short pane higher stays longer: title, model, context, the session's
  // limit, the advisor, the weekly limit, the team, the advisor's last call.
  const rows: HeadRow[] = [
    { row: titleRow(cols, w.lang), stay: 9 },
    gapRow(0.3),
    { row: text(modelRow(s, cols, w)), stay: 8 },
  ]
  const gauge = gaugeOf(s, mode, w)
  const ctx = contextRow(s, mode, cols, motion, w, gauge)
  if (ctx) rows.push({ row: text(ctx), stay: 7 })
  rows.push(
    ...advisorRows(s, mode, cols, now, w),
    gapRow(0.2),
    ...limitRows(s, mode, cols, now, motion, w, gauge, thresholds),
    gapRow(0.1),
    { row: text(teamRow(s, mode, cols, w)), stay: 3 },
    agentsRow(s, mode, cols, w),
  )
  return rows
}

/** A header row that stays this long or longer never goes: the title, the model, the context. */
const NEVER_GOES = 7

/** The header's rows that fit in `room`, the ones that stay longest, in their own order; never fewer than those that never go. */
function trimHeader(rows: readonly HeadRow[], room: number, gaps = true): Row[] {
  const all = gaps ? rows : rows.filter(r => !r.gap)
  if (all.length <= room) return tidy(all, gaps)
  const must = all.filter(r => r.stay >= NEVER_GOES).length
  const kept = new Set([...all].sort((a, b) => b.stay - a.stay).slice(0, Math.max(must, room)))
  return tidy(all.filter(r => kept.has(r)), gaps)
}

// ── tree ────────────────────────────────────────────────────────────────

/** A node of the tree: an agent, or a workflow run with its agents under it. */
type Node = { kind: 'agent'; agent: TreeAgent } | { kind: 'run'; run: TreeRun }
type Vis = { node: Node; children: Vis[] }
/** `kids`: nodes hang under it, so its own line starts beside its detail lines. */
type Item = { node: Node; guides: string; last: boolean; kids: boolean }

function nodeId(n: Node): string {
  return n.kind === 'agent' ? n.agent.id : `run:${n.run.id}`
}

function contains(root: Vis, target: Vis): boolean {
  return root === target || root.children.some(c => contains(c, target))
}

/** Where a node hangs: a run's agent under its run, a run under the agent that called it, any other agent under its parent. */
function parentKey(n: Node, vis: ReadonlyMap<string, Vis>): string | undefined {
  if (n.kind === 'run') return n.run.parentId
  const a = n.agent
  if (a.run !== undefined && vis.has(`run:${a.run}`)) return `run:${a.run}`
  return a.parentId
}

/**
 * The agents and the workflow runs as a forest, in the order they started. A
 * run's row stands where its first agent would (one whose agents the tree no
 * longer holds, by its start), its agents under it.
 */
function forest(s: TreeState): Vis[] {
  const vis = new Map<string, Vis>()
  const order: Vis[] = []
  const add = (node: Node): void => {
    const v: Vis = { node, children: [] }
    vis.set(nodeId(node), v)
    order.push(v)
  }
  const used = new Set(s.agents.map(a => a.run))
  const alone = (s.runs ?? []).filter(r => !used.has(r.id))
  let next = 0
  for (const a of s.agents) {
    while (next < alone.length && alone[next]!.startedAt <= a.startedAt) add({ kind: 'run', run: alone[next++]! })
    const run = runOf(s, a.run)
    if (run && !vis.has(`run:${run.id}`)) add({ kind: 'run', run })
    add({ kind: 'agent', agent: a })
  }
  while (next < alone.length) add({ kind: 'run', run: alone[next++]! })
  const roots: Vis[] = []
  for (const v of order) {
    const key = parentKey(v.node, vis)
    const parent = key !== undefined ? vis.get(key) : undefined
    // A parent that is already below this node would close a loop: the node stays a root.
    if (parent && !contains(v, parent)) parent.children.push(v)
    else roots.push(v)
  }
  return roots
}

/** What becomes of a node that folds away: `count` adds it to the `+ n` row, `quiet` leaves it to its run's counts. */
type Fold = 'show' | 'count' | 'quiet'

function prune(nodes: readonly Vis[], fold: (n: Node) => Fold): { kept: Vis[]; hidden: number } {
  let hidden = 0
  const kept: Vis[] = []
  for (const n of nodes) {
    const sub = prune(n.children, fold)
    hidden += sub.hidden
    const f = fold(n.node)
    if (f !== 'show' && sub.kept.length === 0) {
      if (f === 'count') hidden += 1
      continue
    }
    kept.push({ node: n.node, children: sub.kept })
  }
  return { kept, hidden }
}

function flatten(nodes: readonly Vis[], guides: string, lastAtEnd: boolean, out: Item[]): Item[] {
  nodes.forEach((n, i) => {
    const last = lastAtEnd && i === nodes.length - 1
    out.push({ node: n.node, guides, last, kids: n.children.length > 0 })
    flatten(n.children, guides + (last ? '   ' : '│  '), true, out)
  })
  return out
}

/** Each node's parent in a forest, by id. */
function parentsOf(nodes: readonly Vis[], parent: string | undefined, out: Map<string, string | undefined>): Map<string, string | undefined> {
  for (const n of nodes) {
    out.set(nodeId(n.node), parent)
    parentsOf(n.children, nodeId(n.node), out)
  }
  return out
}

function ancestors(id: string, parents: ReadonlyMap<string, string | undefined>): string[] {
  const chain: string[] = []
  let parent = parents.get(id)
  while (parent !== undefined && !chain.includes(parent)) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return chain
}

/** Which nodes matter most when not all fit: waiting, working, failed, the rest. */
function rank(n: Node): number {
  if (n.kind === 'run') return n.run.end === 'failed' ? 2 : runEnded(n.run) ? 4 : 1
  switch (n.agent.state) {
    case 'waiting':
      return 0
    case 'running':
    case 'starting':
      return 1
    case 'failed':
      return 2
    case 'idle':
      return 3
    default:
      return 4
  }
}

/** When a node last changed, for the order among equals. */
function changed(n: Node): number {
  return n.kind === 'agent' ? n.agent.since : (n.run.endedAt ?? n.run.startedAt)
}

/**
 * An agent's state sign, in the colors the run's counts use (the user's request
 * of 2026-11-19, no gray): at work, starting or idle in its model's color, done
 * green, waiting and stopped yellow, failed red.
 */
function glyph(a: TreeAgent, o: LayoutOptions): Part {
  const color = modelColor(a.model)
  const own: Partial<Part> = color ? { color } : {}
  switch (a.state) {
    case 'running':
      return { text: spin(o), ...own }
    case 'starting':
      return { text: '◌', ...own }
    case 'waiting':
      return { text: '‖', color: 'warning' }
    case 'idle':
      return { text: '○', ...own }
    case 'done':
      return { text: '✓', color: 'success' }
    case 'failed':
      return { text: '✗', color: 'error' }
    case 'stopped':
      return { text: '■', color: 'warning' }
  }
}

function typeTag(a: TreeAgent, member = false): string {
  // Under its run's row a workflow agent needs no `wf`, nor its default type's name.
  const base = a.teammate ? `@${a.name ?? a.type}` : a.fork ? 'fork' : member && a.type === 'workflow-subagent' ? '' : a.type
  return `${base}${a.background ? ' bg' : ''}${a.workflow && !member ? ' wf' : ''}`.trim()
}

function reasonText(a: TreeAgent, w: Words): string {
  switch (a.endReason) {
    case 'refusal':
      return w.refused
    case 'aborted':
      return w.interrupted
    case 'error':
      return w.endedWithError
    default:
      return w.failed
  }
}

function usageParts(a: TreeAgent, mode: Mode, withContext: boolean, motion?: number): Part[] {
  const parts: Part[] = []
  const gap: Part = { text: '  ' }
  if (mode === 'wide') {
    if (a.samples && a.samples.length > 1) parts.push({ text: spark(a.samples, 6), color: modelColor(a.model) }, gap)
    if (a.tokens !== undefined) parts.push({ text: tokens(a.tokens), dim: true }, gap)
    const spent = cost(a.costUsd)
    if (spent) parts.push({ text: spent, dim: true }, gap)
  }
  const p = a.tokens !== undefined && a.window ? (a.tokens / a.window) * 100 : undefined
  if (withContext && p !== undefined) {
    const { icon, color } = weatherFor(p)
    parts.push(
      { text: 'ctx ', dim: true },
      { text: `${icon} `, color },
      ...barParts(p / 100, mode === 'wide' ? 7 : 5, color, motion),
      { text: percent(p), color, bold: true },
    )
  }
  while (parts.length > 0 && parts[parts.length - 1] === gap) parts.pop()
  return parts.filter(p => p.text.length > 0)
}

type Line = { left: Part[]; right: Part[] }

/**
 * An agent's status line: its type and what state it is in, the ctx at the
 * end. A working agent's line gives way at detail 2, a waiting or failed one's
 * only at 3.
 */
function statusLine(a: TreeAgent, mode: Mode, detail: Detail, w: Words, motion?: number, member = false): Line | undefined {
  const tag = typeTag(a, member)
  // A workflow agent of the default type has no type to name: its state alone.
  const lead: Part[] = tag ? [{ text: `${tag} · `, dim: true }] : []
  switch (a.state) {
    case 'starting':
    case 'running': {
      if (detail >= 2) return undefined
      const right = usageParts(a, mode, true, motion)
      const starting: Part[] = a.state === 'starting' ? [{ text: tag ? w.starting : w.starting.replace(/^ · /, ''), dim: true }] : []
      if (!tag && starting.length === 0 && right.length === 0) return undefined
      return { left: [...(tag ? [{ text: tag, dim: true, flex: true }] : []), ...starting], right }
    }
    case 'waiting':
      if (detail >= 3) return undefined
      return {
        left: [...lead, { text: a.label ? `${w.waiting} · ${a.label}` : w.waiting, color: 'warning', flex: true }],
        right: usageParts(a, mode, true, motion),
      }
    case 'failed':
      if (detail >= 3) return undefined
      return {
        left: [...lead, { text: reasonText(a, w), color: 'error', flex: true }],
        right: mode === 'wide' ? usageParts(a, mode, false) : [],
      }
    default:
      return undefined
  }
}

/** The command a working or waiting agent runs now (`Grep src/auth/**`), on a line of its own. */
function commandLine(a: TreeAgent, detail: Detail): Line | undefined {
  if (detail > 0 || !isActive(a)) return undefined
  const what = a.activity ?? a.label
  return what ? { left: [{ text: what, dim: true, flex: true }], right: [] } : undefined
}

/**
 * An agent's model and effort: `Haiku 5.5 · low`, narrow `H5.5 lo`. An agent
 * at work leads its model with a `▾` that opens its panel (`▾Haiku 5.5 · low`);
 * a switch the pane asked for shows as its target (`▾→Sonnet`) until a request
 * has gone with it. Its effort has no sign: a level set mid-run is not carried
 * by the requests that only bring tool results (checked live), so it would
 * change nothing until the agent got a new message.
 */
function agentLabel(a: TreeAgent, mode: Mode, c: TreeChoices | undefined, w: Words, member = false): Part[] {
  const m = modelName(a.model)
  const ended = isEnded(a)
  const color = modelColor(a.model)
  // A workflow's agent takes no message and no switch (checked live: a message
  // reached a second run outside the workflow), so its model has no signs.
  const live = isActive(a) && !member
  const model = mode === 'narrow' ? (m?.short ?? '') : (m?.long ?? '')
  const effort = mode === 'narrow' ? effortShort(a.effort) : effortName(a.effort)
  const modelSign: Partial<Part> = live ? { press: { kind: 'picker', id: 'runModel', agentId: a.id }, key: `picker:runModel:${a.id}` } : {}
  const parts: Part[] = member ? [] : [{ text: mode === 'narrow' ? '✎' : '✎ ', color: TITLE_COLOR, press: { kind: 'compose', agentId: a.id }, key: `compose:${a.id}` }]
  if (model) {
    const target = c?.runModels?.[a.id]
    const pending = live && target !== undefined && stepModel(c, a.id, a.model ?? '') !== undefined
    if (live) parts.push({ text: '▾', color: TITLE_COLOR, ...modelSign })
    parts.push(
      pending
        ? { text: `→${modelChoiceLabel(target, w)}`, color: TITLE_COLOR, ...modelSign }
        : { text: model, color, dim: ended && a.state !== 'failed' && !color ? true : undefined, ...modelSign },
    )
  }
  if (effort) {
    if (model) parts.push({ text: mode === 'narrow' ? ' ' : ' · ', dim: ended || undefined })
    parts.push({ text: effort, dim: ended || undefined })
  }
  return parts
}

/** The width of the model column: the widest label among the agents drawn, so the times line up. */
function modelColumn(s: TreeState, items: readonly Item[], mode: Mode, c: TreeChoices | undefined, w: Words, o: LayoutOptions): number {
  return items.reduce(
    (n, item) => Math.max(n, sum(item.node.kind === 'agent' ? agentLabel(item.node.agent, mode, c, w, isMember(s, item.node.agent)) : runCounts(s, item.node.run, mode, o))),
    0,
  )
}

/**
 * What leads a node's detail lines: the lines of the levels above, and where
 * nodes hang under it, its own line already (`│`), so the tree's line does not
 * break between the node and its first child (the user's request).
 */
function detailIndent(item: Item): string {
  return `${item.guides}${item.last ? '   ' : '│  '}${item.kids ? '│ ' : '  '}`
}

function agentRows(a: TreeAgent, item: Item, mode: Mode, cols: number, o: LayoutOptions, detail: Detail, column: number, w: Words, c: TreeChoices | undefined, member: boolean, nameColor?: string): Row[] {
  const m = modelName(a.model)
  const color = modelColor(a.model)
  const ended = isEnded(a)
  const time = duration((ended ? a.endedAt ?? o.now : o.now) - a.startedAt, w.lang)
  const left: Part[] = [
    { text: `${item.guides}${item.last ? '└─ ' : '├─ '}`, dim: true },
    glyph(a, o),
    { text: ' ' },
    { text: a.description || a.type || a.id, flex: true, ...(nameColor ? { color: nameColor } : {}) },
    ...(a.advisorCalls ? [{ text: ` ◆${a.advisorCalls}`, color: FAMILY_COLOR.fable }] : []),
  ]
  const clock: Part = { text: '', color: TIME_COLOR }
  const label = agentLabel(a, mode, c, w, member)
  const right: Part[] = [{ text: ' '.repeat(Math.max(0, column - sum(label))) }, ...label, { ...clock, text: ` ${time.padStart(mode === 'narrow' ? 5 : 7)}` }]
  // An agent at work: its signs open its panels, the rest of its row its transcript.
  const press: Press = { kind: 'agent', id: a.id }
  const segs = fit(left, right, cols, true)
  const sign = segs.findIndex(x => x.press !== undefined)
  // A workflow's agent opens nothing: the engine shows no transcript of it (`$.ui.view` takes a listed agent).
  const rows: Row[] = member
    ? [text(segs)]
    : sign >= 0
      ? [text(segs.map((x, i) => (i < sign ? { ...x, press, key: `agent:${a.id}` } : x)))]
      : [{ kind: 'press', key: `agent:${a.id}`, press, segs }]
  if (mode === 'narrow' || detail === 3) return rows
  const indent: Part = { text: detailIndent(item), dim: true }
  for (const line of [statusLine(a, mode, detail, w, o.animate ? o.frame : undefined, member), commandLine(a, detail)]) {
    if (line) rows.push(text(fit([indent, ...line.left], line.right, cols)))
  }
  return rows
}

function mainRows(s: TreeState, mode: Mode, cols: number, o: LayoutOptions, below: boolean, detail: Detail, w: Words): Row[] {
  const busy = s.main.isBusy
  const right: Part[] = busy
    ? [{ text: spin(o), color: modelColor(s.main.model) }, { text: ` ${duration(o.now - (s.main.turnStartedAt ?? o.now), w.lang)}`, color: TIME_COLOR }]
    : [{ text: w.idle, dim: true }]
  const left: Part[] = [{ text: 'main', bold: true, color: TRUNK_COLOR }]
  if (s.main.prompt) left.push({ text: mode === 'narrow' ? ' “' : '  “' }, { text: s.main.prompt, flex: true }, { text: '”' })
  const rows: Row[] = [{ kind: 'press', key: 'main', press: { kind: 'main' }, segs: fit(left, right, cols, true) }]
  if (mode !== 'narrow' && detail === 0 && busy && s.main.activity) {
    const tools: Part[] = mode === 'wide' ? [{ text: w.tools(s.main.tools), dim: true }] : []
    rows.push(text(fit([{ text: below ? '│  ' : '   ', dim: true }, { text: s.main.activity, dim: true, flex: true }], tools, cols)))
  }
  return rows
}

function introRows(mode: Mode, cols: number, w: Words): Row[] {
  const intro = text(fit([{ text: `   ${w.intro}`, dim: true }], [], cols))
  return mode === 'narrow' ? [intro] : [text([{ text: ' ' }]), intro]
}

/** The newest finished node that is no run's agent: an agent, or a run that ended well. */
function latestFinished(s: TreeState): string | undefined {
  let best: { id: string; at: number } | undefined
  for (const a of s.agents) {
    if ((a.state === 'done' || a.state === 'stopped') && !isMember(s, a) && (!best || (a.endedAt ?? 0) >= best.at)) best = { id: a.id, at: a.endedAt ?? 0 }
  }
  for (const r of s.runs ?? []) {
    if (runEnded(r) && r.end !== 'failed' && (!best || (r.endedAt ?? 0) >= best.at)) best = { id: `run:${r.id}`, at: r.endedAt ?? 0 }
  }
  return best?.id
}

// ── workflow runs ───────────────────────────────────────────────────────

/**
 * A run's counts, as the team row counts: `× 6  4✓ 1⠹ 1✗` (narrow `×6 4✓1⠹1✗`),
 * the agents the tree no longer holds included; the noughts left out.
 */
function runCounts(s: TreeState, r: TreeRun, mode: Mode, o: LayoutOptions): Part[] {
  const t = runTally(s, r)
  const narrow = mode === 'narrow'
  // The total in the run's own color, its sign's (the user's request: no gray).
  const parts: Part[] = [{ text: narrow ? `×${t.total}` : `× ${t.total}`, color: TRUNK_COLOR }]
  const counts: Part[] = []
  // Each in a color of its own, none gray (the user's request): done green, at
  // work in its agents' model color (as their spinners), waiting and stopped
  // yellow, failed red; the sign tells waiting from stopped.
  const working = s.agents.find(a => a.run === r.id && (a.state === 'running' || a.state === 'starting'))
  const workColor = modelColor(working?.model)
  if (t.done > 0) counts.push({ text: `${t.done}✓`, color: 'success' })
  if (t.active > 0) counts.push({ text: `${t.active}${spin(o)}`, ...(workColor ? { color: workColor } : {}) })
  if (t.waiting > 0) counts.push({ text: `${t.waiting}‖`, color: 'warning' })
  if (t.failed > 0) counts.push({ text: `${t.failed}✗`, color: 'error' })
  if (t.stopped > 0) counts.push({ text: `${t.stopped}■`, color: 'warning' })
  counts.forEach((c, i) => parts.push({ text: narrow ? (i === 0 ? ' ' : '') : i === 0 ? '  ' : ' ' }, c))
  return parts
}

/**
 * A workflow run's row: `▣`, its name, its counts in the model column, its
 * time; under it (normal and wide, while nothing has to give way) its
 * description. Pressing it shows all of its agents, or folds them again.
 */
function runRows(r: TreeRun, item: Item, s: TreeState, mode: Mode, cols: number, o: LayoutOptions, detail: Detail, column: number, w: Words, nameColor?: string): Row[] {
  const ended = runEnded(r)
  const failed = r.end === 'failed'
  // A node the tree branches from: in the trunk's color, as its lines (the user's request); red when the run failed.
  const sign: Part = failed ? { text: '▣', color: 'error' } : { text: '▣', color: TRUNK_COLOR }
  const time = duration((ended ? (r.endedAt ?? o.now) : o.now) - r.startedAt, w.lang)
  const left: Part[] = [
    { text: `${item.guides}${item.last ? '└─ ' : '├─ '}`, dim: true },
    sign,
    { text: ' ' },
    { text: r.name || 'workflow', flex: true, ...(nameColor ? { color: nameColor } : {}) },
  ]
  const counts = runCounts(s, r, mode, o)
  const right: Part[] = [{ text: ' '.repeat(Math.max(0, column - sum(counts))) }, ...counts, { text: ` ${time.padStart(mode === 'narrow' ? 5 : 7)}`, color: TIME_COLOR }]
  // When it started, beside its name, where the name keeps its whole length
  // with it (the user's request: two runs of one workflow told apart).
  const started: Part[] = [{ text: '  ' }, { text: at(r.startedAt, o.now, w.lang), color: TIME_COLOR }]
  const withStart = mode !== 'narrow' && sum(left) + sum(started) + sum(right) < cols ? [...left, ...started] : left
  const rows: Row[] = [{ kind: 'press', key: `run:${r.id}`, press: { kind: 'run', id: r.id }, segs: fit(withStart, right, cols, true) }]
  if (mode !== 'narrow' && detail === 0 && r.about) {
    const indent: Part = { text: detailIndent(item), dim: true }
    rows.push(text(fit([indent, { text: r.about, dim: true, flex: true }], [], cols)))
  }
  return rows
}

/**
 * Whether a workflow run shows all of its agents: as its row was last pressed
 * to (`openRuns`, `closedRuns`), else as `f` says (`showFinished`). The row's
 * press wins over `f` (the user's report of 2026-11-19: with `f` on, a run
 * could not be folded any more); `f` clears what the rows were pressed to.
 */
export function runOpen(ui: TreeUi, id: string): boolean {
  if ((ui.closedRuns ?? []).includes(id)) return false
  if ((ui.openRuns ?? []).includes(id)) return true
  return ui.showFinished
}

function treeRows(s: TreeState, ui: TreeUi, mode: Mode, cols: number, o: LayoutOptions, detail: Detail, w: Words, limit?: number): Row[] {
  if (s.agents.length === 0 && (s.runs ?? []).length === 0) return [...mainRows(s, mode, cols, o, false, detail, w), ...introRows(mode, cols, w)]
  const keep = latestFinished(s)
  const open = (r: TreeRun): boolean => runOpen(ui, r.id)
  // Finished agents fold into `+ n finished`, but the newest; a run's finished
  // agents into its own counts, while it is not opened (its row's press wins
  // over `f`, the user's report of 2026-11-19); a run that ended well as one
  // finished node.
  const fold = (n: Node): Fold => {
    if (n.kind === 'run') return ui.showFinished || !runEnded(n.run) || n.run.end === 'failed' || nodeId(n) === keep ? 'show' : 'count'
    const a = n.agent
    if (a.state !== 'done' && a.state !== 'stopped') return 'show'
    const run = runOf(s, a.run)
    if (run) return open(run) ? 'show' : 'quiet'
    if (ui.showFinished) return 'show'
    return a.id === keep ? 'show' : 'count'
  }
  const pruned = prune(forest(s), fold)
  let kept = pruned.kept
  let more = 0
  if (limit !== undefined) {
    const items = flatten(kept, '', true, [])
    const room = Math.max(0, limit - 2)
    if (items.length > room) {
      const parents = parentsOf(kept, undefined, new Map())
      const ranked = [...items].sort((x, y) => rank(x.node) - rank(y.node) || changed(y.node) - changed(x.node))
      const chosen = new Set<string>()
      for (const item of ranked) {
        const id = nodeId(item.node)
        const chain = ancestors(id, parents).filter(x => !chosen.has(x))
        if (chosen.size + chain.length + 1 > room) continue
        for (const x of chain) chosen.add(x)
        chosen.add(id)
      }
      const cutDown = prune(kept, n => (chosen.has(nodeId(n)) ? 'show' : 'count'))
      kept = cutDown.kept
      more = cutDown.hidden
    }
  }
  const summary = pruned.hidden + more
  const rows = mainRows(s, mode, cols, o, kept.length > 0 || summary > 0, detail, w)
  const items = flatten(kept, '', summary === 0, [])
  const column = modelColumn(s, items, mode, s.choices, w, o)
  // The names each in a color of their own, one row after the other (the user's request).
  items.forEach((item, i) => {
    const n = item.node
    const name = NAME_COLORS[i % NAME_COLORS.length]
    rows.push(...(n.kind === 'run' ? runRows(n.run, item, s, mode, cols, o, detail, column, w, name) : agentRows(n.agent, item, mode, cols, o, detail, column, w, s.choices, isMember(s, n.agent), name)))
  })
  if (summary > 0) {
    const label = more > 0 ? w.more(summary) : w.finished(summary)
    const right: Part[] = more > 0 || mode === 'narrow' ? [] : [{ text: w.show, dim: true }]
    rows.push({ kind: 'press', key: 'finished', press: { kind: 'finished' }, segs: fit([{ text: '└─ ', dim: true }, { text: label, dim: true }], right, cols, true) })
  }
  // The light runs on the lines idle too, whenever motion is on (the user's request of 2026-11-19).
  return trunk(rows, o.animate ? o.frame : undefined)
}

/**
 * The tree's lines in the trunk color. While things work a light runs down
 * each of them, a row a frame, and turns into each branch it passes, as the
 * dots run along the lines in the plan's video: the trunk from `main`, and
 * every line inside the tree too (a run's, an agent's with agents of its own),
 * each with a light of its own (the user's rule, 2026-11-19).
 */
function trunk(rows: Row[], motion: number | undefined): Row[] {
  const isGuide = (seg: Seg | undefined): boolean => seg !== undefined && /^[ │├└─]+$/.test(seg.text) && /[│├└─]/.test(seg.text)
  const heads = rows.map(r => (r.kind === 'keys' ? '' : (r.segs[0]?.text ?? '')))
  // The lit cells, by row: a line's own column, and the dash after it where it turns into a branch.
  const lit = new Map<number, Set<number>>()
  if (motion !== undefined) {
    const widest = heads.reduce((n, h) => Math.max(n, h.length), 0)
    // A line runs down one column (a level is three cells), over the rows that
    // hold `│`, `├` or `└` there one after another; each line has its own light.
    for (let col = 0; col < widest; col += 3) {
      let start = -1
      for (let i = 0; i <= rows.length; i++) {
        const on = i < rows.length && /[│├└]/.test(heads[i]![col] ?? '')
        if (on && start < 0) start = i
        if (on || start < 0) continue
        const length = i - start
        const step = motion % (length + PULSE_REST)
        if (step < length) {
          const row = start + step
          const cells = lit.get(row) ?? new Set<number>()
          cells.add(col)
          if (heads[row]![col + 1] === '─') cells.add(col + 1)
          lit.set(row, cells)
        }
        start = -1
      }
    }
  }
  return rows.map((r, i) => {
    if (r.kind === 'keys' || !isGuide(r.segs[0])) return r
    const first = r.segs[0]!
    const guide = first.text
    // On an agent at work's row the guide is part of the button that opens its transcript.
    const keep: Partial<Seg> = first.press ? { press: first.press, key: first.key } : {}
    const cells = lit.get(i)
    // While the light runs, the lines say so (`live`): an idle pane keeps redrawing for them, as for a bar's light.
    const moving: Partial<Seg> = motion !== undefined ? { live: true } : {}
    const head: Seg[] = []
    for (let c = 0; c < guide.length; c++) {
      const on = cells?.has(c) === true
      const last = head[head.length - 1]
      if (last && (last.color === PULSE_COLOR) === on) last.text += guide[c]
      else head.push(on ? { text: guide[c]!, color: PULSE_COLOR, bold: true, ...moving, ...keep } : { text: guide[c]!, color: TRUNK_COLOR, ...moving, ...keep })
    }
    return { ...r, segs: [...head, ...r.segs.slice(1)] }
  })
}

// ── log, keys, help, glance ─────────────────────────────────────────────

function logGlyph(entry: LogEntry, s: TreeState): Part {
  switch (entry.kind) {
    case 'spawn': {
      const a = entry.agentId === undefined ? undefined : s.agents.find(x => x.id === entry.agentId)
      return { text: '●', color: modelColor(a?.model) }
    }
    case 'done':
      return { text: '✓', color: 'success' }
    case 'failed':
      return { text: '✗', color: 'error' }
    case 'stopped':
      return { text: '■', color: 'warning' }
    case 'waiting':
      return { text: '‖', color: 'warning' }
    case 'advisor':
      return { text: '◆', color: FAMILY_COLOR.fable }
    case 'context': {
      const weather = weatherFor(entry.percent ?? 75)
      return { text: weather.icon, color: weather.color }
    }
    case 'compact':
      return { text: '⇣', dim: true }
    case 'model':
      return { text: '⇄', dim: true }
    case 'message':
      return { text: '✎', color: TITLE_COLOR }
    case 'run': {
      // A run's start plain, its end in the color of how it ended.
      const phrase = entry.say?.phrase
      if (phrase === 'runDone') return { text: '▣', color: 'success' }
      if (phrase === 'failed') return { text: '▣', color: 'error' }
      if (phrase === 'stopped') return { text: '▣', color: 'warning' }
      return { text: '▣' }
    }
  }
}

/** What a log entry says, in the pane's language; an older entry's own text where it has no phrase. */
function logText(entry: LogEntry, w: Words): string {
  const say = entry.say
  if (!say) return entry.text
  const t = w.log
  switch (say.phrase) {
    case 'spawned':
      return t.spawned(String(say.value ?? ''))
    case 'found':
      return t.found(String(say.value ?? ''))
    case 'calledBy':
      return t.calledBy(String(say.value ?? ''))
    case 'context':
      return t.context(Number(say.value ?? 0))
    case 'done':
      return t.done(Number(say.value ?? 0))
    case 'messaged':
      return w.messageLog
    case 'runDone':
      return `${w.legend.done} · × ${Number(say.value ?? 0)}`
    default:
      return t[say.phrase]
  }
}

/** A log entry's length on the right, in the pane's language: an advisor call's in tenths of a second. */
function logRight(entry: LogEntry, w: Words): string | undefined {
  if (entry.ms === undefined) return entry.right
  return entry.kind === 'advisor' ? seconds(entry.ms, w.lang) : duration(entry.ms, w.lang)
}

function logRows(s: TreeState, mode: Mode, cols: number, n: number, w: Words): Row[] {
  return s.log.slice(0, n).map(entry => {
    const g = logGlyph(entry, s)
    const said = logText(entry, w)
    const right = logRight(entry, w)
    if (mode === 'narrow') {
      const what = [entry.label, said, right].filter(Boolean).join(' · ')
      return text(fit([g, { text: ' ' }, { text: what, flex: true }], [{ text: clock(entry.at), color: TIME_COLOR }], cols))
    }
    const cells = mode === 'wide' ? 21 : 16
    const label = cut(entry.label, cells)
    const left: Part[] = [
      { text: clock(entry.at), color: TIME_COLOR },
      { text: ' ' },
      g,
      { text: ' ' },
      { text: `${label}${' '.repeat(Math.max(0, cells - width(label)))} ` },
      { text: said, dim: true, flex: true },
    ]
    return text(fit(left, right ? [{ text: right, color: TIME_COLOR }] : [], cols))
  })
}

function keysRow(mode: Mode, cols: number, view: TreeView, w: Words): Row {
  const k = w.keys
  const options: KeyButton = { key: 'key-options', hotkey: 'o', label: view === 'options' ? k.back : k.options, press: { kind: 'options' } }
  const help: KeyButton = { key: 'key-help', hotkey: 'h', label: view === 'help' ? k.back : k.help, press: { kind: 'help' } }
  const buttons: KeyButton[] =
    view === 'tree'
      ? [
          { key: 'key-finished', hotkey: 'f', label: k.finished, press: { kind: 'finished' } },
          { key: 'key-log', hotkey: 'l', label: k.log, press: { kind: 'log' } },
          options,
          help,
        ]
      : [options, help]
  const hints: KeyItem[] = view !== 'tree' || mode === 'narrow' ? [] : mode === 'wide' ? [{ text: k.focusWide }, { text: k.open }] : [{ text: k.focus }, { text: k.open }]
  let items: KeyItem[] = [...hints, ...buttons]
  while (items.length > buttons.length && rowWidth({ kind: 'keys', items }) > cols) items = items.slice(1)
  // Too wide even so (the narrow view, a long language): the buttons show their keys alone (`f:`), which still press them.
  if (rowWidth({ kind: 'keys', items }) > cols) items = buttons.map(b => ({ ...b, label: '' }))
  return { kind: 'keys', items }
}

function helpRows(mode: Mode, cols: number, w: Words): Row[] {
  const l = w.legend
  const legend: Part[][] = [
    [{ text: SPINNER[2] }, { text: ` ${l.running}  ` }, { text: '✓', color: 'success' }, { text: ` ${l.done}  ` }, { text: '✗', color: 'error' }, { text: ` ${l.failed}  ` }, { text: '■', color: 'warning' }, { text: ` ${l.stopped}` }],
    [{ text: '◌' }, { text: ` ${l.starting}  ` }, { text: '‖', color: 'warning' }, { text: ` ${l.waiting}  ` }, { text: '○' }, { text: ` ${l.idle}` }],
    [
      { text: '●', color: FAMILY_COLOR.opus },
      { text: ' Opus  ' },
      { text: '●', color: FAMILY_COLOR.sonnet },
      { text: ' Sonnet  ' },
      { text: '●', color: FAMILY_COLOR.haiku },
      { text: ' Haiku  ' },
      { text: '◆', color: FAMILY_COLOR.fable },
      { text: ' Fable' },
    ],
    [{ text: 'ctx  ', dim: true }, { text: l.context, flex: true }],
    [
      { text: '     ' },
      { text: weatherFor(0).icon, color: weatherFor(0).color },
      { text: ' <25  ' },
      { text: weatherFor(25).icon, color: weatherFor(25).color },
      { text: ' <50  ' },
      { text: weatherFor(50).icon, color: weatherFor(50).color },
      { text: ' <75  ' },
      { text: '☇', color: weatherFor(75).color },
      { text: ' <90  ' },
      { text: '↯', color: weatherFor(90).color },
      { text: ' 90+' },
    ],
    [{ text: '~    ', dim: true }, { text: l.estimated, flex: true }],
    [{ text: '▲ ▼  ', dim: true }, { text: l.delta, flex: true }],
    [{ text: 'effort ', dim: true }, { text: l.effort, flex: true }],
    [{ text: '≈$   ', dim: true }, { text: l.cost, flex: true }],
    [{ text: '◆    ', color: FAMILY_COLOR.fable }, { text: l.advisor[0], flex: true }],
    [{ text: '     ' }, { text: l.advisor[1], flex: true }],
    [{ text: '     ' }, { text: l.advisor[2], flex: true }],
    [{ text: '▾', color: TITLE_COLOR }, { text: `${w.lang}  `, dim: true }, { text: l.lang, flex: true }],
    [{ text: '▾', color: TITLE_COLOR }, { text: 'Opus ', dim: true }, { text: l.pickers, flex: true }],
    [{ text: `${w.agents} `, dim: true }, { text: l.agents, flex: true }],
    [{ text: '✎    ', color: TITLE_COLOR }, { text: w.messageLegend, flex: true }],
    [{ text: '▣', color: TRUNK_COLOR }, { text: '    ' }, { text: l.workflow, flex: true }],
  ]
  return [
    titleRow(cols),
    text(fit([{ text: l.title, bold: true }], [], cols)),
    sep(cols),
    ...legend.map(parts => text(fit(parts, [], cols))),
    sep(cols),
    ...l.keys.map(line => text(fit([{ text: line, dim: true, flex: true }], [], cols))),
    // How to close the pane and open it again from the prompt (the user's request of 2026-11-19).
    text(fit([{ text: l.commands, dim: true, flex: true }], [], cols)),
    // Where the mod lives (the user's request of 2026-11-19): a link a click opens.
    text(fit([{ text: 'GitHub  ', dim: true }, { text: REPO_URL, href: REPO_URL, color: TITLE_COLOR, flex: true }], [], cols)),
    keysRow(mode, cols, 'help', w),
  ]
}

// ── options page ────────────────────────────────────────────────────────

/** A number option's bounds and step; the limit thresholds bound each other (red stays above yellow). */
function numberSpec(field: OptionField, v: Settings['values']): { min: number; max: number; step: number; percent?: true } | undefined {
  switch (field) {
    case 'columns':
      return { min: 36, max: 120, step: 4 }
    case 'logRows':
      return { min: 0, max: 20, step: 1 }
    case 'limitWarnAt':
      return { min: 5, max: Math.min(95, Number(v.limitAlertAt) - 5), step: 5, percent: true }
    case 'limitAlertAt':
      return { min: Math.max(10, Number(v.limitWarnAt) + 5), max: 100, step: 5, percent: true }
    default:
      return undefined
  }
}

/**
 * An option's value as the page's buttons: `on` / `off`, a press switching it
 * (on in the chosen color); a number between `−` and `+`, each a step, held
 * to its bounds (a bound's sign dim and still). A locked one shows its value alone.
 */
function optionValue(field: OptionField, value: boolean | number, v: Settings['values'], locked: boolean, w: Words): Part[] {
  const key = `option:${field}`
  if (typeof value === 'boolean') {
    const word = (value ? w.on : w.off).replace(/^\s*·\s*/, '')
    const look: Partial<Part> = value ? { color: PICKED_COLOR, bold: true } : {}
    return locked ? [{ text: word, ...look }] : [{ text: word, ...look, press: { kind: 'option', field, value: !value }, key }]
  }
  const spec = numberSpec(field, v)
  const shown = `${value}${spec?.percent ? '%' : ''}`
  if (locked || !spec) return [{ text: shown }]
  const down = Math.max(spec.min, value - spec.step)
  const up = Math.min(spec.max, value + spec.step)
  const minus: Part = down < value ? { text: '−', color: TITLE_COLOR, press: { kind: 'option', field, value: down }, key: `${key}:down` } : { text: '−', dim: true }
  const plus: Part = up > value ? { text: '+', color: TITLE_COLOR, press: { kind: 'option', field, value: up }, key: `${key}:up` } : { text: '+', dim: true }
  return [minus, { text: ` ${shown} ` }, plus]
}

/**
 * The options page (`o`, the user's request of 2026-11-19, plan 06): each of
 * the mod's options a row, its name on the left and its value as buttons on
 * the right, a dim line about it under it (normal and wide views); the
 * language by its own name, its `▾` opening the language panel; a note that
 * the choices go into Claude Code's settings. In a short pane the lines about
 * the options go first, then the note.
 */
function optionsRows(s: TreeState, ui: TreeUi, mode: Mode, cols: number, w: Words, o: LayoutOptions): Row[] {
  const v = o.settings?.values ?? DEFAULT_SETTINGS
  const locked = new Set(o.settings?.locked ?? [])
  const t = w.options
  const lines: Array<{ row: Row; about?: true }> = []
  for (const field of OPTION_ORDER) {
    lines.push({ row: text(fit([{ text: t.labels[field], flex: true }], optionValue(field, v[field], v, locked.has(field), w), cols, true)) })
    if (mode !== 'narrow') lines.push({ row: text(fit([{ text: `  ${t.about[field]}`, dim: true, flex: true }], [], cols)), about: true })
  }
  const press: Press = { kind: 'picker', id: 'lang' }
  const name = LANGS.find(l => l.code === w.lang)?.name ?? w.lang
  lines.push({
    row: text(fit([{ text: t.language, flex: true }], [{ text: '▾', color: TITLE_COLOR, press, key: 'picker:lang' }, { text: name, press, key: 'picker:lang' }], cols, true)),
  })
  const panel = ui.picker === 'lang' ? panelRows('lang', s, ui, cols, w) : []
  const head: Row[] = [titleRow(cols), ...panel, text(fit([{ text: t.title, bold: true }], [], cols)), sep(cols)]
  let body = lines
  let note: Row[] = [sep(cols), text(fit([{ text: t.note, dim: true, flex: true }], [], cols))]
  const total = (): number => head.length + body.length + note.length + 1
  if (o.rows !== undefined && total() > o.rows) body = lines.filter(l => !l.about)
  if (o.rows !== undefined && total() > o.rows) note = []
  return [...head, ...body.map(l => l.row), ...note, keysRow(mode, cols, 'options', w)]
}

function glance(s: TreeState, cols: number, o: LayoutOptions, w: Words): Row {
  const count = (states: readonly string[]): number => s.agents.filter(a => states.includes(a.state)).length
  const running = count(['running', 'starting'])
  const waiting = count(['waiting'])
  const done = count(['done'])
  const failed = count(['failed'])
  const what = [
    modelName(s.main.model)?.long ?? 'main',
    running > 0 ? w.glance.running(running) : '',
    waiting > 0 ? w.glance.waiting(waiting) : '',
    done > 0 ? w.glance.done(done) : '',
    failed > 0 ? w.glance.failed(failed) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const right = [s.advisor.total > 0 ? `◆${s.advisor.total}` : '', cost(s.main.costUsd, s.main.hasUnknownPrice)].filter(Boolean).join(' · ')
  const lead: Part = anyActive(s) ? { text: spin(o), color: modelColor(s.main.model) } : { text: '○', dim: true }
  return text(fit([lead, { text: ' ' }, { text: what, flex: true }], right ? [{ text: right, dim: true }] : [], cols))
}

// ── choice panel ────────────────────────────────────────────────────────

/** A choice panel's frame and title: the cyan of the pane's name and its `▾`. */
const PANEL_COLOR = TITLE_COLOR
/** The value chosen now, in a choice panel. */
export const PICKED_COLOR = 'cyanBright'
/** The cells between two options side by side. */
const OPTION_GAP = 3

/** One option of a panel: its value, its name, and a short name where a pane is too short for the long ones. */
export type Choice = { value: string; label: string; short?: string }

type Picker = { title: string; choices: Choice[]; current: string | undefined; note?: string }

function pickerOf(id: PickerId, s: TreeState, ui: TreeUi, w: Words): Picker {
  switch (id) {
    case 'lang':
      return { title: w.chooseLanguage, choices: LANGS.map(l => ({ value: l.code, label: l.name, short: l.code })), current: ui.lang ?? 'en' }
    case 'model': {
      const offer = s.choices?.offer?.length ? s.choices.offer : FALLBACK_OFFER
      return {
        title: w.sessionModel,
        choices: offer.map(alias => ({ value: alias, label: modelChoiceLabel(alias, w) })),
        current: s.choices?.modelSetting ?? aliasOf(s.main.model),
        note: w.savedAsDefault,
      }
    }
    case 'effort':
      return {
        title: w.sessionEffort,
        choices: EFFORT_LEVELS.map(level => ({ value: level, label: level })),
        current: typeof s.main.effort === 'string' ? s.main.effort : undefined,
        note: w.savedAsDefault,
      }
    case 'advisor':
      return {
        title: w.advisorTitle,
        choices: [...ADVISOR_OFFER.map(alias => ({ value: alias, label: modelChoiceLabel(alias, w) })), { value: 'off', label: w.offLabel }],
        current: s.advisor.off || !s.advisor.model ? 'off' : (aliasOf(s.advisor.model) ?? s.advisor.model),
        note: w.savedAsDefault,
      }
    case 'agentModel':
      return {
        title: w.agentModelTitle,
        choices: [{ value: 'auto', label: w.auto }, ...agentOffer(s).map(alias => ({ value: alias, label: modelChoiceLabel(alias, w) }))],
        current: s.choices?.agentModel ?? 'auto',
        note: w.agentModelNote,
      }
    case 'agentEffort':
      return {
        title: w.agentEffortTitle,
        choices: [{ value: 'auto', label: w.auto }, ...EFFORT_LEVELS.map(level => ({ value: level, label: level }))],
        current: s.choices?.agentEffort ?? 'auto',
        note: w.agentEffortNote,
      }
    case 'msgEffort':
      return {
        title: w.messageTo(agentName(s, ui.compose)),
        choices: [{ value: 'auto', label: w.auto }, ...EFFORT_LEVELS.map(level => ({ value: level, label: level }))],
        current: ui.composeEffort ?? (ui.compose !== undefined ? s.choices?.pins?.[ui.compose] : undefined) ?? 'auto',
      }
    case 'runModel':
      return {
        title: w.runModelTitle(agentName(s, ui.pickerFor)),
        choices: [{ value: 'auto', label: w.auto }, ...agentOffer(s).map(alias => ({ value: alias, label: modelChoiceLabel(alias, w) }))],
        current: (ui.pickerFor !== undefined ? s.choices?.runModels?.[ui.pickerFor] : undefined) ?? 'auto',
        note: w.runModelNote,
      }
  }
}

/** A running agent's name in its panels' titles: its description, else its type. */
function agentName(s: TreeState, id: string | undefined): string {
  const a = s.agents.find(x => x.id === id)
  return a ? a.description || a.type : (id ?? '?')
}

/** The models the advisor panel offers: what Claude Code takes as an advisor (opus, sonnet, fable), the strongest first. */
export const ADVISOR_OFFER: readonly string[] = ['fable', 'opus', 'sonnet']

/** The models new subagents can be given: the families `/model` offers, else the three. */
export function agentOffer(s: TreeState): string[] {
  const families = (s.choices?.offer ?? []).filter(alias => /^(opus|sonnet|haiku|fable)$/.test(alias))
  return families.length > 0 ? families : ['opus', 'sonnet', 'haiku']
}

/**
 * The open choice panel, framed under the header: its title in the top edge,
 * its options side by side on as many lines as they need, the chosen one
 * colored; `×` at the end closes it. Every line is `cols` cells.
 */
export function panelRows(id: PickerId, s: TreeState, ui: TreeUi, cols: number, w: Words, withNote = true, short = false): Row[] {
  const p = pickerOf(id, s, ui, w)
  const choices = short ? p.choices.map(c => ({ ...c, label: c.short ?? c.label })) : p.choices
  return frameRows(id, p.title, choices, p.current, cols, withNote ? p.note : undefined)
}

/**
 * A choice panel's rows for any options: the frame, the options wrapped to
 * `cols`, `×`, and under them a dim note when given (what a choice also does).
 */
export function frameRows(
  id: PickerId,
  title: string,
  choices: readonly Choice[],
  current: string | undefined,
  cols: number,
  note?: string,
  more: { lead?: Seg[]; after?: Row[]; foot?: string } = {},
): Row[] {
  const inner = cols - 4
  const edge = (t: string): Seg => ({ text: t, color: PANEL_COLOR })
  const name = cut(title, Math.max(1, cols - 6))
  const top: Seg[] = [edge('╭─ '), { text: name, color: PANEL_COLOR, bold: true }, edge(` ${'─'.repeat(Math.max(0, cols - 5 - width(name)))}╮`)]
  // A lead (the message panel's `effort:`) opens the first line.
  const lines: Seg[][] = [[...(more.lead ?? [])]]
  let used = sum(more.lead ?? [])
  // Options on the current line: the lead carries its own space, so the first option after it takes no gap.
  let onLine = 0
  for (const c of choices) {
    const label = cut(c.label, inner)
    const cells = width(label)
    if (used > 0 && used + (onLine > 0 ? OPTION_GAP : 0) + cells > inner) {
      lines.push([])
      used = 0
      onLine = 0
    }
    const line = lines[lines.length - 1]!
    const gap = onLine > 0 ? OPTION_GAP : 0
    if (gap > 0) line.push({ text: ' '.repeat(gap) })
    const picked = c.value === current
    line.push({ text: label, press: { kind: 'choose', id, value: c.value }, key: `choose:${id}:${c.value}`, ...(picked ? { color: PICKED_COLOR, bold: true } : {}) })
    used += gap + cells
    onLine += 1
  }
  // `×` at the end of the last line, or on a line of its own.
  if (used > 0 && used + OPTION_GAP + 1 > inner) lines.push([])
  const close: Seg = { text: '×', press: { kind: 'close' }, key: `close:${id}` }
  const body = lines.map((line, i) => {
    const last = i === lines.length - 1
    const pad = inner - sum(line) - (last ? 1 : 0)
    return text([edge('│ '), ...line, { text: ' '.repeat(Math.max(0, pad)) }, ...(last ? [close] : []), edge(' │')].filter(s => s.text.length > 0))
  })
  if (note) {
    const said = cut(note, inner)
    body.push(text([edge('│ '), { text: said, dim: true }, { text: ' '.repeat(Math.max(0, inner - width(said))) }, edge(' │')]))
  }
  // A word in the bottom edge (the message panel's hint), in the frame's color (the user's request).
  const said = more.foot ? cut(more.foot, Math.max(1, cols - 6)) : ''
  const bottom: Seg[] = said
    ? [edge('╰─ '), { text: said, color: PANEL_COLOR }, edge(` ${'─'.repeat(Math.max(0, cols - 5 - width(said)))}╯`)]
    : [edge(`╰${'─'.repeat(cols - 2)}╯`)]
  return [text(top), ...body, ...(more.after ?? []), text(bottom)]
}

/** The message field's key: what the pane draws it under, and what the focus is moved onto. */
export function fieldKey(agentId: string): string {
  return `message:${agentId}`
}

/**
 * How many lines the message field is tall: three (the user's choice of
 * 2026-11-19, after a live check). A field of one line does not scroll, so a
 * longer text was not seen, and Up and Down walk only a field of two lines or
 * more; a short pane gets two. The engine's ` · shift+⏎ new line` beside a
 * field of several lines is kept off by the field's label (`messageLabel`).
 */
export const FIELD_LINES = 3

/**
 * The message panel at the pane's foot: its title (`Message to <agent>`) in
 * the top edge, `effort:` and the levels the message sets on the agent, the
 * hint in the bottom edge (`Type your message below`), then under the frame the
 * field, the pane's width, `lines` tall, its label before it (`üzenet: `). The
 * engine sizes a focused field to the pane's whole width, so no frame edge can
 * stand beside it (the user's live check of 2026-11-19). In a pane too short
 * for it, the field takes two lines.
 */
export function composeRows(s: TreeState, ui: TreeUi, cols: number, w: Words, draft?: string, lines = FIELD_LINES): Row[] {
  const agentId = ui.compose
  if (agentId === undefined) return []
  const p = pickerOf('msgEffort', s, ui, w)
  const label = w.messageLabel
  // what the engine draws before the field: the label and `: `
  const lead = `${label}: `
  const room = Math.max(1, cols - width(lead))
  const field: Row = {
    kind: 'input',
    key: fieldKey(agentId),
    agentId,
    ...(draft ? { value: draft } : {}),
    label,
    lines,
    // the cells after the label: the field's blank placeholder fills them, so a click anywhere on its lines reaches it
    room,
    segs: [{ text: lead }, { text: ' '.repeat(room) }],
  }
  // The field's further lines: drawn by the field, counted here so the pane's height adds up.
  const covered: Row[] = Array.from({ length: lines - 1 }, () => ({ kind: 'text', segs: [{ text: ' '.repeat(cols) }], covered: true }))
  // No note for a finished agent any more (the user's request): the legend says a message resumes it.
  const frame = frameRows('msgEffort', `✎ ${p.title}`, p.choices, p.current, cols, undefined, {
    lead: [{ text: w.effortLabel, dim: true }],
    // The hint in the frame's bottom edge, over the field, in the frame's color (the user's request).
    foot: w.messageHint,
  })
  return [...frame, field, ...covered]
}

// ── the line above the prompt ───────────────────────────────────────────

/** A style of the band line, as token-weather's: Ink's Text props. */
export type BandStyle = { color?: string; bold?: boolean; dimColor?: boolean }

/** One part of the band line; a part of runs (the agents' signs) draws each run in its own style. */
export type BandPart = { text: string; style: BandStyle; runs?: Array<{ text: string; style: BandStyle }> }

/** What separates the parts, as in token-weather. */
export const BAND_GAP = '  '

/** The agents' signs on the band line: the most recent this many. */
const BAND_AGENTS = 16

/** A workflow run's sign on the band line: one for all of its agents, in the color of how it stands. */
function bandRunSign(r: TreeRun): { text: string; style: BandStyle } {
  if (r.end === 'failed') return { text: '▣', style: { color: 'error' } }
  return { text: '▣', style: runEnded(r) ? { dimColor: true } : {} }
}

function bandSign(a: TreeAgent): { text: string; style: BandStyle } {
  switch (a.state) {
    case 'running':
    case 'starting':
      return { text: '●', style: modelColor(a.model) ? { color: modelColor(a.model) } : {} }
    case 'waiting':
      return { text: '‖', style: { color: 'warning' } }
    case 'failed':
      return { text: '✗', style: { color: 'error' } }
    case 'done':
      return { text: '✓', style: { dimColor: true } }
    case 'stopped':
      return { text: '■', style: { dimColor: true } }
    case 'idle':
      return { text: '○', style: { dimColor: true } }
  }
}

/**
 * The line above the prompt while the pane is closed, drawn as token-weather
 * draws its own (the user's rule): parts two spaces apart, the first in a
 * color, the second bold, the third plain, then a part of runs (token-weather's
 * chart; here a sign for each agent, in its model's or its state's color), and
 * a dim one last. Fitted to `cols` as token-weather's: what does not fit goes
 * from the end, the signs before the counts.
 */
export function bandLine(s: TreeState, cols: number, o: { frame: number; animate: boolean; lang?: Lang }): BandPart[] {
  const w = wordsFor(o.lang)
  const busy = anyActive(s)
  const lead: BandPart = {
    text: `${busy ? (o.animate ? SPINNER[o.frame % SPINNER.length]! : '●') : '○'} ${modelName(s.main.model)?.long ?? 'main'}`,
    style: modelColor(s.main.model) ? { color: modelColor(s.main.model) } : {},
  }
  const count = (states: readonly string[]): number => s.agents.filter(a => states.includes(a.state)).length
  const running = count(['running', 'starting'])
  const waiting = count(['waiting'])
  const done = count(['done'])
  const failed = count(['failed'])
  const first = running > 0 ? w.glance.running(running) : waiting > 0 ? w.glance.waiting(waiting) : w.legend.idle
  const rest = [running > 0 && waiting > 0 ? w.glance.waiting(waiting) : '', done > 0 ? w.glance.done(done) : '', failed > 0 ? w.glance.failed(failed) : '']
    .filter(Boolean)
    .join(' · ')
  const counts: BandPart = { text: first, style: { bold: true } }
  const others: BandPart | undefined = rest ? { text: rest, style: {} } : undefined
  const runs: Array<{ text: string; style: BandStyle }> = []
  // A sign for each agent, the latest ones; a workflow run's agents one sign together.
  const seen = new Set<string>()
  const marks: Array<{ text: string; style: BandStyle }> = []
  for (const a of s.agents) {
    const run = runOf(s, a.run)
    if (!run) marks.push(bandSign(a))
    else if (!seen.has(run.id)) {
      seen.add(run.id)
      marks.push(bandRunSign(run))
    }
  }
  for (const sign of marks.slice(-BAND_AGENTS)) {
    const last = runs[runs.length - 1]
    if (last && JSON.stringify(last.style) === JSON.stringify(sign.style)) last.text += sign.text
    else runs.push({ ...sign })
  }
  const signs: BandPart | undefined = runs.length > 0 ? { text: runs.map(r => r.text).join(''), style: {}, runs } : undefined
  const spent = cost(s.main.costUsd, s.main.hasUnknownPrice)
  const tailText = [s.advisor.total > 0 ? `◆${s.advisor.total}` : '', spent].filter(Boolean).join(' · ')
  const tail: BandPart | undefined = tailText ? { text: tailText, style: { dimColor: true } } : undefined
  const keep = (parts: ReadonlyArray<BandPart | undefined>): BandPart[] => parts.filter((p): p is BandPart => p !== undefined)
  const lines = [
    keep([lead, counts, others, signs, tail]),
    keep([lead, counts, others, tail]),
    keep([lead, counts, others]),
    keep([lead, counts]),
  ]
  const cells = (parts: readonly BandPart[]): number => parts.reduce((n, p) => n + width(p.text), width(BAND_GAP) * (parts.length - 1))
  return lines.find(parts => cells(parts) <= cols) ?? [lead]
}

// ── the whole pane ──────────────────────────────────────────────────────

export function layout(s: TreeState, ui: TreeUi, o: LayoutOptions): Row[] {
  const cols = Math.max(24, Math.floor(o.cols))
  const w = wordsFor(ui.lang)
  if (o.placement === 'widget') return [glance(s, cols, o, w)]
  const mode = modeOf(cols)
  if (ui.view === 'help') return helpRows(mode, cols, w)
  if (ui.view === 'options') return optionsRows(s, ui, mode, cols, w, o)
  let foot = 2 // a separator and the keys, or the message panel
  // Bars shimmer whenever motion is on, idle too; the trunk's pulse only while things work (treeRows).
  const fullHead = header(s, mode, cols, o.now, o.animate ? o.frame : undefined, w, o.limits)
  // The message panel takes the foot, the keys' place, under a separator; the tree and the log give it room.
  let compose = ui.compose !== undefined ? composeRows(s, ui, cols, w, o.draft) : []
  if (compose.length > 0) foot = compose.length + 1
  // An open choice panel goes under the header. The header gives it room down
  // to the rows that never go; the tree gives it all of its own, and comes back
  // when the panel closes. Where even then it does not fit, its note goes, then
  // its options take their short names.
  let panel = ui.picker ? panelRows(ui.picker, s, ui, cols, w) : []
  const headOf = (gaps: boolean): Row[] => (o.rows === undefined ? tidy(fullHead, gaps) : trimHeader(fullHead, o.rows - 1 - foot - MIN_TREE - panel.length, gaps))
  // The header's empty rows give way first: where the whole tree does not fit beside them, there are none.
  let head = headOf(true)
  if (o.rows !== undefined && head.length + panel.length + 1 + treeRows(s, ui, mode, cols, o, 0, w).length + (panel.length > 0 ? 0 : foot) > o.rows) head = headOf(false)
  if (ui.picker && o.rows !== undefined && head.length + panel.length > o.rows) panel = panelRows(ui.picker, s, ui, cols, w, false)
  // Still too tall (the languages): the options by their short names, the codes.
  if (ui.picker && o.rows !== undefined && head.length + panel.length > o.rows) panel = panelRows(ui.picker, s, ui, cols, w, false, true)
  // The message panel too tall for what the header leaves: its note goes.
  // Too tall for what the header leaves: the field two lines (it still scrolls, and Up and Down still walk it).
  if (compose.length > 0 && o.rows !== undefined && head.length + 1 + compose.length > o.rows) {
    compose = composeRows(s, ui, cols, w, o.draft, 2)
    foot = compose.length + 1
  }
  let tree = treeRows(s, ui, mode, cols, o, 0, w)
  if (o.rows !== undefined) {
    const below = o.rows - head.length - panel.length - 1
    // The message panel never goes, so the tree gives it all of its room; the keys row may go instead.
    const room = panel.length > 0 ? below : compose.length > 0 ? below - foot : Math.max(2, below - foot)
    if (room < 2) tree = []
    else {
      if (tree.length > room) tree = treeRows(s, ui, mode, cols, o, 1, w)
      if (tree.length > room) tree = treeRows(s, ui, mode, cols, o, 2, w)
      if (tree.length > room) tree = treeRows(s, ui, mode, cols, o, 3, w)
      if (tree.length > room) tree = treeRows(s, ui, mode, cols, o, 3, w, room)
    }
  }
  const out: Row[] = [...head, ...panel, ...(tree.length > 0 ? [sep(cols), ...tree] : [])]
  if (ui.showLog && s.log.length > 0) {
    const wanted = o.logRows ?? LOG_ROWS
    const most = mode === 'narrow' ? Math.min(1, wanted) : wanted
    const room = o.rows === undefined ? most : o.rows - out.length - foot - 1
    const n = Math.min(most, s.log.length, room)
    if (n > 0) out.push(sep(cols), ...logRows(s, mode, cols, n, w))
  }
  if (compose.length > 0) {
    // A separator parts the panel from the log (the user's request). Docked,
    // the panel sits at the pane's very foot: blank rows fill the room between.
    // Inline the frame fits the tree, so nothing fills it there.
    out.push(sep(cols))
    if (o.rows !== undefined && o.placement !== 'inline') {
      for (let gap = o.rows - out.length - compose.length; gap > 0; gap--) out.push(text([{ text: ' ' }]))
    }
    out.push(...compose)
  } else if (o.rows === undefined || out.length + foot <= o.rows) out.push(sep(cols), keysRow(mode, cols, 'tree', w))
  return out
}
