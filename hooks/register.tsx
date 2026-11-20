// The mod's wiring. Events become state changes (model.ts) on an in-memory
// copy of the tree; a ticker polls `$.agent.list()`, writes the copy to
// `$.state` at most four times a second and turns the spinner; the pane
// draws the layout (layout.ts) with the surface's elements.
//
// The pane changes something only when the person picks it in a choice panel:
// /model, /effort and /advisor run through $.command.run, exactly as if typed;
// a new subagent is given the model chosen for new subagents (agent.spawn) and
// its requests the effort (turn.step); a running one's requests the model it
// was switched to (turn.step); an option picked on the options page through
// $.config.set, as if set in /config. Otherwise every hook passes its event on
// unchanged, and a fault in the mod passes it on unchanged too (.catch).
//
// Its sounds (sounds.ts, plan 09) play only with the Sound option on: macOS
// through $.audio.play, Windows through PowerShell, Linux through paplay or aplay.
//
// The one thing it does on its own is its update (update.ts, plan 07): with
// the Auto-update option on, once a day at an interactive start, a copy
// installed from a marketplace reads its version on GitHub and, when it is
// newer, runs `claude plugin update`.
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, TextProps, Timer } from 'claude-code'

import type { Lang, TreeLimit, TreeState, TreeUi } from '../types'
import { EFFORT_LEVELS, LIMIT_THRESHOLDS, TITLE_TEXT, effortLevel, modelEffort } from './format'
import type { LimitThresholds } from './format'
import { ADVISOR_OFFER, BAND_GAP, DEFAULT_SETTINGS, OPTION_FIELDS, agentOffer, aliasOf, bandLine, fieldKey, hasLiveCell, isButton, layout, runOpen } from './layout'
import type { Press, Row, Seg, Settings, ThemeKind } from './layout'
import { SOUND_BEEPS, SOUND_OPTION, heardOf, pickSound, soundEvents, soundFile } from './sounds'
import { BOOT_MS, EFFECT_MS, effectsEnd } from './hud'
import type { Heard, SoundEvent } from './sounds'
import {
  anyActive,
  compacted,
  configured,
  effortText,
  emptyTree,
  estimatedContext,
  advisorSet,
  adoptStrays,
  listed,
  mainChanged,
  messagePin,
  messaged,
  pinBack,
  rememberedLimits,
  measured,
  orphaned,
  prompted,
  runLaunched,
  runNoticed,
  settleRuns,
  taskNotices,
  spawned,
  stepped,
  toolCalled,
  turnMeasured,
  turnCompleted,
  turnStarted,
  pendingSettled,
  recordOf,
  spawnModel,
  staleRecords,
  stepEffort,
  stepModel,
  withChoices,
} from './model'
import type { ListedAgent, PinBefore, RunFacts, SpawnFacts } from './model'
import { NAME, chooseLang, isLang, wordsFor } from './words'
import type { OptionField } from './words'
import { UPDATE_KEY, checkForUpdate, switchedOff } from './update'
import type { UpdateHost } from './update'

const PANE = 'forge-tree'
/** The plugin's name: its options are `/config` rows keyed `<plugin>.<field>`. */
const PLUGIN = 'forge-agent-tree'
/** The options a policy locks: the options page shows them with no buttons. Read at each load (a change of options reloads the plugin) and when the page opens. */
let lockedOptions: OptionField[] = []
/** Each option's /config key, as the menu lists it (`<plugin>.<field>`). */
let optionKeys: Partial<Record<OptionField, string>> = {}
const TITLE = TITLE_TEXT
const TREE_SHAPE = 'tree-2'
const TICK_MS = 125
const FLUSH_MS = 250
const POLL_BUSY_MS = 1000
/** With motion off, the clock still moves elapsed times once a second. */
const SLOW_TICKS = 8
/** With nothing at work, a tick calls nothing but a look at the agent list every 3 s. */
const IDLE_TICKS = 24
/** After a /resume or a /clear, how long every tick looks for the session that takes over. */
const SWAP_WATCH_MS = 10_000
/** While idle, a bar's light moves every this many ticks (250 ms): half the working pace. */
const IDLE_SHIMMER_TICKS = 2
/** While idle, how often a pane with a countdown or an age (`in 2h12m`, `2m ago`) is drawn again. */
const CLOCK_REDRAW_MS = 60_000
/** How often the settings are read again for the advisor: /advisor saves there, from any session. */
const SETTINGS_EVERY_MS = 10_000
/** How long a /model or /effort the pane ran may take to take effect: it waits until Claude is idle. */
const PENDING_MS = 10 * 60_000
/** A session's record in the store (its subagent choices) is kept this long, and at most this many. */
const RECORD_MS = 30 * 86_400_000
const RECORDS_KEPT = 100
const RECORD_PREFIX = 'session:'
/** What a command answers when it changed nothing: a model it does not take, a feature not available. */
const REFUSED = /can't|cannot|not available|not supported|unknown|invalid|usage:/i
/** How a command's answer starts when it did change it (Claude Code 2.1.328), looked at before REFUSED. */
const LANDED: Readonly<Record<'model' | 'effort' | 'advisor', RegExp>> = {
  model: /^(Set model to|Kept model as)/i,
  effort: /^Set effort level to/i,
  advisor: /^(Advisor set to|Advisor disabled)/i,
}

const treeRef = { plugin: 'forge-agent-tree', key: 'tree' } as const
const uiRef = { plugin: 'forge-agent-tree', key: 'ui' } as const
const frameRef = { plugin: 'forge-agent-tree', key: 'frame' } as const
const paneRef = { plugin: 'forge-agent-tree', key: 'pane' } as const

const tree = atom(treeRef, emptyTree(0), { shape: TREE_SHAPE })
const uiState = atom(uiRef, { showFinished: false, showLog: true, view: 'tree' } as TreeUi, { shape: 'ui-3' })
const frameAtom = atom(frameRef, 0)
/** Bumped whenever the pane opens or closes, so the line above the prompt draws again. */
const paneAtom = atom(paneRef, 0)

/** The pane opened or closed: the line above the prompt looks again. */
async function paneMoved($: EngineInterface): Promise<void> {
  await update($, paneAtom, n => (n + 1) % 1000).catch(() => undefined)
}

// The module's own working copy: lost on a reload, rebuilt from $.state.
let mem: TreeState | undefined
let pending: Array<(s: TreeState) => TreeState> = []
let dirty = false
let lastFlush = 0
let lastPoll = 0
let pollSoon = false
let frame = 0
let ticks = 0
let ticking = false
let animate = true
let ticker: Timer | undefined
let commandName: string | undefined
let watchSwapUntil = 0
let lastSettings = 0
let lastClockRedraw = 0
let savedLimits = ''
/** The last drawing held a bar's moving light: idle ticks keep it moving. */
let shimmering = false
/** The pane's language, for what is said outside the pane too: the command, a toast. */
let lang: Lang = 'en'

function change(fn: (s: TreeState) => TreeState): void {
  if (mem) {
    mem = fn(mem)
    dirty = true
  } else {
    pending.push(fn)
  }
}

/** Records an event beside its own work: nothing here is awaited before the event goes on. */
function note($: EngineInterface, fn: (s: TreeState, now: number) => TreeState, poll = false): void {
  void $.clock.now().then(
    now => {
      change(s => fn(s, now))
      if (poll) pollSoon = true
    },
    () => undefined,
  )
}

function fromInfo(a: AgentInfo): ListedAgent {
  return {
    id: a.id,
    parentId: a.parentId,
    description: a.description,
    type: a.type,
    name: a.name ?? a.teammateId,
    status: a.status,
    label: a.label,
    startTime: a.startTime,
    // A model switched mid-run shows in the last request; the agent's own field keeps the first.
    model: a.lastRequest?.model ?? a.model,
    // What the last request carried; the agent's own field is what its definition or call set.
    effort: a.lastRequest?.effort ?? a.effort,
    tokenCount: a.tokenCount,
    contextWindowSize: a.contextWindowSize,
    tokenSamples: a.tokenSamples,
    costUsd: a.cost?.usd,
    teammate: a.kind === 'in_process_teammate',
    models: a.usage?.map(u => u.model),
  }
}

async function flush($: EngineInterface, now: number, force = false): Promise<void> {
  if (!mem || !dirty) return
  if (!force && now - lastFlush < FLUSH_MS) return
  dirty = false
  lastFlush = now
  await $.state.set(treeRef, { shape: TREE_SHAPE, value: mem }).catch(() => {
    dirty = true
  })
}

async function poll($: EngineInterface, now: number): Promise<void> {
  const list = await $.agent.list().catch(() => undefined)
  if (!list || !mem) return
  const before = JSON.stringify([mem.agents, mem.runs])
  // A run with no notification and nothing at work for a while is taken as ended;
  // an agent no spawn named, seen while one run works, is that run's.
  const next = adoptStrays(settleRuns(listed(mem, list.map(fromInfo), now), now), now)
  if (JSON.stringify([next.agents, next.runs]) !== before || next.log !== mem.log) {
    mem = next
    dirty = true
  }
}

async function tick($: EngineInterface): Promise<void> {
  if (ticking || !mem) return
  ticks += 1
  const busy = anyActive(mem)
  const watching = watchSwapUntil > 0
  // A running effect of the HUD (a boot, an unfolding panel, an event's flash) draws live cells, so it keeps this going too.
  const idleShimmer = animate && shimmering
  if (!busy && !pollSoon && !dirty && !watching && !idleShimmer && ticks % IDLE_TICKS !== 0) return
  ticking = true
  try {
    const now = await $.clock.now()
    if (watching && now > watchSwapUntil) watchSwapUntil = 0
    const due = pollSoon || (busy ? now - lastPoll >= POLL_BUSY_MS : ticks % IDLE_TICKS === 0)
    // Another session in place gets a tree of its own before anything else is drawn.
    if (watching || due) await adopt($, now)
    if (due) {
      pollSoon = false
      lastPoll = now
      await poll($, now)
    }
    const c = mem?.choices
    if (due && (c?.pendingModel !== undefined || c?.pendingEffort !== undefined || c?.pendingAdvisor !== undefined)) await settle($)
    if (due && now - lastSettings >= SETTINGS_EVERY_MS) {
      lastSettings = now
      await readOffer($)
      await readTheme($)
      const advisor = await advisorSetting($)
      if (mem) {
        const next = advisorSet(mem, advisor)
        if (next !== mem) {
          mem = next
          dirty = true
        }
      }
    }
    // Working, the spinner turns; idle, a countdown or an age still moves, once a minute.
    const clockText = mem !== undefined && (mem.advisor.calls.length > 0 || (mem.main.limits ?? []).some(l => l.resetsAt))
    // While an event's effect runs (the HUD's motion), every frame, so it does not wait for the idle pace.
    const effects = mem !== undefined && current.hud !== false ? Math.max(effectsEnd(mem), (bootAt ?? 0) + BOOT_MS.reveal, (panelAt ?? 0) + EFFECT_MS.unfold) : 0
    const redraw =
      mem !== undefined && anyActive(mem)
        ? animate || ticks % SLOW_TICKS === 0
        : (animate && now < effects) || (idleShimmer && ticks % IDLE_SHIMMER_TICKS === 0) || (due && clockText && now - lastClockRedraw >= CLOCK_REDRAW_MS)
    if (redraw) {
      lastClockRedraw = now
      frame = (frame + 1) % 1000
      await $.state.set(frameRef, frame).catch(() => undefined)
    }
    await rememberLimits($)
    await flush($, now)
    listen($, now)
  } finally {
    ticking = false
  }
}

/**
 * `session.start` runs once a process; a /resume or a /clear swaps the session
 * under it, and `$.state` is the new session's, empty. When the session id
 * moves, the tree starts over for the session now in place: its model and
 * advisor read again, what the agent list no longer shows stopped.
 */
async function adopt($: EngineInterface, now: number): Promise<void> {
  const id = await $.session.id().catch(() => undefined)
  if (!mem || id === undefined || id === mem.sessionId) return
  const before = mem
  const stored = await read($, tree).catch(() => undefined)
  const model = await $.session.model().catch(() => undefined)
  const advisor = await advisorSetting($)
  const effort = await configuredEffort($, model ?? before.main.model)
  const list = await $.agent.list().catch(() => [] as AgentInfo[])
  // Events noted during these calls went to the old tree; the list catches the new one up.
  const base = stored && stored.startedAt > 0 && stored.sessionId === id ? stored : emptyTree(now)
  let s = advisorSet(configured(orphaned(base, new Set(list.map(a => a.id)), now), { model, effort }), advisor)
  s = {
    ...s,
    sessionId: id,
    main: {
      ...s.main,
      model: s.main.model ?? before.main.model,
      effort: s.main.effort ?? before.main.effort,
      // The plan's limits are the account's, not the session's: they carry over.
      limits: s.main.limits ?? before.main.limits,
      limitsEstimated: s.main.limits ? s.main.limitsEstimated : before.main.limitsEstimated,
    },
  }
  mem = listed(s, list.map(fromInfo), now)
  // What the new session already holds sounds nothing.
  heard = undefined
  watchSwapUntil = 0
  dirty = true
  await readContext($, now).catch(() => undefined)
  await readOffer($)
  await readLocks($)
  // A change of options reloads the plugin, and this runs again: the page's locks and keys, fresh.
  await readOptionLocks($).catch(() => undefined)
  await restoreRecord($)
  await flush($, now, true)
  await restorePrefs($)
}

/**
 * The context's fill right away, before any response: the status line's
 * figure where a response of this window gave one, else a local estimate of
 * what the window holds (`breakdown: 'summary'` sends no API request). The cost
 * and the rate limits come along either way.
 */
async function readContext($: EngineInterface, now: number): Promise<void> {
  const usage = await $.session.usage().catch(() => undefined)
  if (!usage || !mem) return
  const context = usage.context
  const known = context.percent
  const facts = {
    tokens: context.tokens,
    window: context.window,
    costUsd: usage.cost?.usd,
    hasUnknownPrice: usage.cost?.hasUnknownPrice === true,
    limits: usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
  }
  if (known !== undefined) {
    const used = context.tokens
    change(s => {
      const next = measured(s, { ...facts, percent: known }, now)
      return used === undefined ? next : { ...next, main: { ...next.main, lastTurnTokens: used } }
    })
    return
  }
  change(s => measured(s, facts, now))
  const detailed = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const breakdown = detailed?.context.breakdown
  const window = context.window || breakdown?.rawMaxTokens || 0
  if (!breakdown || window <= 0) return
  const used = breakdown.totalTokens
  change(s => estimatedContext(s, { percent: (used / window) * 100, tokens: used, window }))
}

/**
 * The main loop's effort as configured for `model`: CLAUDE_CODE_EFFORT_LEVEL,
 * then the model's own level in the `modelSettings` setting (where /effort
 * saves it, per model), then the `effortLevel` setting. A `--effort` flag is in
 * none; each model request then says what it really asks (`turn.step`), and
 * that wins.
 */
async function configuredEffort($: EngineInterface, model: string | undefined): Promise<string | undefined> {
  const fromEnv = effortLevel(await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined))
  if (fromEnv) return fromEnv
  const perModel = modelEffort(await $.settings.read({ key: 'modelSettings' }).catch(() => undefined), model)
  if (perModel) return perModel
  return effortLevel(await $.settings.read({ key: 'effortLevel' }).catch(() => undefined))
}

/** The context when a main turn ended, set against the turn before (token-weather's reading). */
async function recordTurn($: EngineInterface): Promise<void> {
  const usage = await $.session.usage().catch(() => undefined)
  const context = usage?.context
  if (!context || context.tokens === undefined || context.percent === undefined) return
  const reading = { tokens: context.tokens, window: context.window, percent: context.percent }
  note($, (s, now) => turnMeasured(s, reading, now))
}

/** The pane's choices kept across sessions ($.store), and its language, into this session's state. */
/**
 * The pane's toggles kept for every session (the store's `ui`): whether the
 * log shows (`l`), and whether the finished agents do (`f`, global since the
 * user's decision of 2026-11-19).
 */
async function savePrefs($: EngineInterface, u: TreeUi): Promise<void> {
  await $.store.set('ui', { showLog: u.showLog, showFinished: u.showFinished }).catch(() => undefined)
}

async function restorePrefs($: EngineInterface): Promise<void> {
  const prefs = await $.store.get('ui').catch(() => undefined)
  const kept = prefs && typeof prefs === 'object' ? (prefs as { showLog?: unknown; showFinished?: unknown }) : {}
  const showLog = typeof kept.showLog === 'boolean' ? kept.showLog : undefined
  const showFinished = typeof kept.showFinished === 'boolean' ? kept.showFinished : undefined
  await update($, uiState, (u: TreeUi): TreeUi => ({
    ...u,
    ...(showLog === undefined ? {} : { showLog }),
    ...(showFinished === undefined ? {} : { showFinished }),
    lang,
  })).catch(() => undefined)
}

/**
 * The pane's language: the person's choice, kept for every session in the
 * store; else read off Claude Code's `language` setting, the runtime's locale
 * or LC_ALL / LANG (chooseLang); else English. A reading is never saved.
 */
async function readLang($: EngineInterface): Promise<Lang> {
  const saved = await $.store.get('language').catch(() => undefined)
  if (isLang(saved)) return saved
  const setting = await $.settings.read({ key: 'language' }).catch(() => undefined)
  let locale: string | undefined
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    locale = undefined
  }
  const env = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
  return chooseLang({ saved, setting, locale, env })
}

/** Keeps the limits a response reported ($.store), so the next session shows them from its start. */
async function rememberLimits($: EngineInterface): Promise<void> {
  if (!mem || mem.main.limitsEstimated || !(mem.main.limits ?? []).length) return
  const text = JSON.stringify(mem.main.limits)
  if (text === savedLimits) return
  savedLimits = text
  await $.store.set('limits', mem.main.limits).catch(() => undefined)
}

/** The limits an earlier session kept, while a response here has reported none. */
async function recallLimits($: EngineInterface, now: number): Promise<void> {
  if (!mem || (mem.main.limits ?? []).length > 0) return
  const saved = await $.store.get('limits').catch(() => undefined)
  if (!Array.isArray(saved)) return
  const limits = saved.filter(
    (l): l is TreeLimit => typeof l === 'object' && l !== null && typeof l.kind === 'string' && typeof l.percent === 'number',
  )
  change(s => rememberedLimits(s, limits, now))
}

/**
 * The advisor as configured: off where CLAUDE_CODE_DISABLE_ADVISOR_TOOL is set,
 * else the model the settings name (what `/advisor` saves). A `--advisor` flag
 * of an interactive session is in neither; its first call shows it on.
 */
async function advisorSetting($: EngineInterface): Promise<{ model?: string; off?: boolean }> {
  const disabled = await $.env.get('CLAUDE_CODE_DISABLE_ADVISOR_TOOL').catch(() => undefined)
  if (disabled && disabled !== '0' && disabled.toLowerCase() !== 'false') return { off: true }
  return { model: await advisorModel($) }
}

async function advisorModel($: EngineInterface): Promise<string | undefined> {
  const saved = await $.settings.read({ key: 'advisorModel' }).catch(() => undefined)
  if (typeof saved === 'string' && saved) return saved
  // `--advisor` is not saved to settings; the config menu may still show it.
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(r => /advisor/i.test(r.key))
  const value = row?.value
  return typeof value === 'string' && value && !/^(off|none|false)$/i.test(value) ? value : undefined
}

async function registerCommand($: EngineInterface): Promise<string | undefined> {
  const description = wordsFor(lang).command.description
  const first = await $.command
    .register({ name: 'tree', description, argumentHint: '[close]' })
    .then(r => r.command, () => undefined)
  if (first) return first
  const second = await $.command
    .register({ name: 'forge-tree', description, argumentHint: '[close]' })
    .then(r => r.command, () => undefined)
  if (!second) $.ui.toast(wordsFor(lang).command.none)
  return second
}

/** The options as `register` gets them, defaults filled in by the engine. */
type Options = { [K in OptionField]?: unknown }

/** The options of this load: the ticker reads them (a change of options reloads the plugin). */
let current: Options = {}

/** The system the session runs on, as `uname -s` names it (`Darwin`, `Windows_NT`, `Linux`). */
let sysname: string | undefined
/** The plugin's folder, where its sounds are (`CLAUDE_PLUGIN_ROOT`); null where it could not be read. */
let pluginRoot: string | null | undefined
/** When each event last sounded, and any sound (`any`). */
const lastSounds: Record<string, number> = {}
/** What the sounds last heard of the session, to tell what changed (sounds.ts). */
let heard: Heard | undefined
/** The power-up sounds once a process, at the pane's first opening. */
let poweredUp = false
/** When the HUD's boot sequence started (plan 08, F3): the pane's first opening in the process, with motion on. */
let bootAt: number | undefined
/** When a panel last opened: the HUD unfolds it (F2). */
let panelAt: number | undefined

/** Whether an event sounds: the Sound option on (off by default), and the event's own (on by default). */
function soundOn(options: Options, event: SoundEvent): boolean {
  return flagOf(options, 'sound') && flagOf(options, SOUND_OPTION[event])
}

/** A switch as set, else its default (the engine fills them in; the defaults stand where it did not). */
function flagOf(options: Options, field: OptionField): boolean {
  const v = options[field]
  return typeof v === 'boolean' ? v : DEFAULT_SETTINGS[field] === true
}

/** The plugin's own folder, read once. */
async function rootOf($: EngineInterface): Promise<string | null> {
  if (pluginRoot === undefined) pluginRoot = (await $.process.hookEnv().catch(() => ({}) as Record<string, string>)).CLAUDE_PLUGIN_ROOT ?? null
  return pluginRoot
}

/**
 * Plays an event's sound (plan 09). macOS through the engine's player; a
 * Windows terminal has none, so PowerShell plays the file (its SoundPlayer),
 * else beeps the event's tune; Linux through paplay, else aplay. Nothing here
 * is awaited by what raised it.
 */
async function playSound($: EngineInterface, event: SoundEvent): Promise<void> {
  sysname ??= (await $.session.machine().catch(() => undefined))?.sysname ?? ''
  if (sysname === 'Darwin') {
    await $.audio.play({ asset: soundFile(event) }).catch(() => undefined)
    return
  }
  const root = await rootOf($)
  if (sysname.startsWith('Windows')) {
    if (root) {
      const file = `${root.replace(/[\\/]+$/, '')}\\${soundFile(event).replace('/', '\\')}`
      const play = `(New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`
      const played = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', play], { timeoutMs: 8000 }).catch(() => undefined)
      if (played?.exitCode === 0) return
    }
    const beeps = SOUND_BEEPS[event].map(([hz, ms]) => `[console]::beep(${hz},${ms})`).join('; ')
    await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', beeps], { timeoutMs: 5000 }).catch(() => undefined)
    return
  }
  if (!root) return
  const file = `${root.replace(/\/+$/, '')}/${soundFile(event)}`
  for (const argv of [['paplay', file], ['aplay', '-q', file]]) {
    const played = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
    if (played?.exitCode === 0) return
  }
}

/** The events the last change of state raised (sounds.ts): the one that sounds now, unawaited. */
function listen($: EngineInterface, now: number): void {
  if (!mem) return
  const thresholds = thresholdsOf(current)
  const before = heard
  heard = heardOf(mem, thresholds)
  if (!before) return
  const event = pickSound(soundEvents(before, mem, thresholds), e => soundOn(current, e), lastSounds, now)
  if (!event) return
  lastSounds[event] = now
  lastSounds.any = now
  void playSound($, event).catch(() => undefined)
}

/** The HUD's boot sequence, from now: once a process, with the HUD on and motion on. */
async function startBoot($: EngineInterface, options: Options): Promise<void> {
  if (poweredUp || bootAt !== undefined || !animate || options.hud === false) return
  bootAt = await $.clock.now().catch(() => undefined)
}

/** The power-up, at the pane's first opening in this process. */
function powerUp($: EngineInterface, options: Options): void {
  if (poweredUp) return
  poweredUp = true
  if (soundOn(options, 'boot')) void playSound($, 'boot').catch(() => undefined)
}

/** Claude Code's theme as the HUD reads it: a dark one, a light one, or one of ANSI colors only. */
let theme: ThemeKind = 'dark'

async function readTheme($: EngineInterface): Promise<void> {
  const value = await $.settings.read({ key: 'theme' }).catch(() => undefined)
  const t = typeof value === 'string' ? value.toLowerCase() : ''
  theme = t.includes('ansi') ? 'ansi' : t.startsWith('light') ? 'light' : 'dark'
}

/**
 * The mod's own update (plan 07): with the Auto-update option on (the
 * default), at an interactive start, unless a switch that turns updates off
 * is set. The check itself keeps to once a day (update.ts). Never awaited by
 * the start. A toast says when a newer version was installed, and when it
 * could not be, with the command to run by hand.
 */
async function autoUpdate($: EngineInterface, isInteractive: boolean, options: Options): Promise<void> {
  if (!isInteractive || options.autoUpdate === false) return
  const off = [
    await $.env.get('DO_NOT_TRACK').catch(() => undefined),
    await $.env.get('DISABLE_AUTOUPDATER').catch(() => undefined),
    await $.env.get('DISABLE_UPDATES').catch(() => undefined),
    await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC').catch(() => undefined),
  ]
  if (switchedOff(off)) return
  const host: UpdateHost = {
    load: () => $.store.get(UPDATE_KEY),
    save: async record => {
      await $.store.set(UPDATE_KEY, record)
    },
    list: async () => (await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: 30_000 })).stdout,
    // The one request the mod makes: the repository's plugin.json, for its version.
    manifest: async () => {
      const answer = await $.http.fetch('https://raw.githubusercontent.com/JZO001/forge-agent-tree/main/.claude-plugin/plugin.json')
      return answer.ok ? answer.text : undefined
    },
    run: async argv => (await $.process.run(argv, { timeoutMs: 120_000 })).exitCode,
  }
  const result = await checkForUpdate(host, await $.clock.now())
  const w = wordsFor(lang)
  if (result.kind === 'updated') $.ui.toast(w.updated(result.to))
  else if (result.kind === 'failed') $.ui.toast(w.updateFailed(result.to, result.command))
}

/** The mod's options in the /config rows: each one's key, and which a policy locks. */
async function readOptionLocks($: EngineInterface): Promise<void> {
  const rows = await $.config.list()
  const mine = rows.filter(r => r.provider?.plugin === PLUGIN || r.key.startsWith(`${PLUGIN}.`))
  const fieldOf = (key: string): OptionField | undefined => OPTION_FIELDS.find(f => key === f || key.endsWith(`.${f}`))
  const keys: Partial<Record<OptionField, string>> = {}
  const locked: OptionField[] = []
  for (const r of mine) {
    const field = fieldOf(r.key)
    if (field === undefined) continue
    keys[field] = r.key
    if (r.isLocked) locked.push(field)
  }
  optionKeys = keys
  lockedOptions = locked
}

/** The options as in effect, for the options page. */
function settingsOf(options: Options): Settings {
  const t = thresholdsOf(options)
  // A switch as set, else its default.
  const flag = (f: OptionField): boolean => flagOf(options, f)
  return {
    values: {
      openOnStart: flag('openOnStart'),
      animate: flag('animate'),
      hud: flag('hud'),
      columns: columnsOf(options),
      logRows: logRowsOf(options),
      limitWarnAt: t.warn,
      limitAlertAt: t.alert,
      bandLine: bandOn(options),
      sound: flag('sound'),
      advisorSound: flag('advisorSound'),
      soundSpawn: flag('soundSpawn'),
      soundDone: flag('soundDone'),
      soundFailed: flag('soundFailed'),
      soundWaiting: flag('soundWaiting'),
      soundTurn: flag('soundTurn'),
      soundAlert: flag('soundAlert'),
      soundBoot: flag('soundBoot'),
      autoUpdate: flag('autoUpdate'),
    },
    locked: lockedOptions,
  }
}

/** Whether the line above the prompt is drawn while the pane is closed (on by default). */
function bandOn(options: Options): boolean {
  return options.bandLine !== false
}

/** A whole number from an option, held between `lo` and `hi`; `fallback` where it is none. */
function whole(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback
}

/** How many log rows the pane shows (0 to 20). */
function logRowsOf(options: Options): number {
  return whole(options.logRows, 5, 0, 20)
}

/** Where the limit bars turn yellow and red; red at least one point above yellow. */
function thresholdsOf(options: Options): LimitThresholds {
  const warn = whole(options.limitWarnAt, LIMIT_THRESHOLDS.warn, 1, 99)
  const alert = whole(options.limitAlertAt, LIMIT_THRESHOLDS.alert, warn + 1, 100)
  return { warn, alert }
}

function columnsOf(options: Options): number {
  return typeof options.columns === 'number' && options.columns >= 24 ? Math.floor(options.columns) : 56
}

async function boot($: EngineInterface, isInteractive: boolean, options: Options): Promise<void> {
  const now = await $.clock.now()
  const stored = await read($, tree).catch(() => undefined)
  const model = await $.session.model().catch(() => undefined)
  const advisor = await advisorSetting($)
  const effort = await configuredEffort($, model)
  const reduced =await $.settings.read({ key: 'prefersReducedMotion' }).catch(() => undefined)
  const sessionId = await $.session.id().catch(() => undefined)
  animate = options.animate !== false && reduced !== true
  // No await between taking what queued up and installing the copy.
  let s = stored && stored.startedAt > 0 && (stored.sessionId === undefined || stored.sessionId === sessionId) ? stored : emptyTree(now)
  for (const fn of pending) s = fn(s)
  pending = []
  mem = { ...advisorSet(configured(s, { model, effort }), advisor), sessionId }
  lastSettings = now
  dirty = true
  await readContext($, now).catch(() => undefined)
  await readOffer($)
  await readLocks($)
  // A change of options reloads the plugin, and this runs again: the page's locks and keys, fresh.
  await readOptionLocks($).catch(() => undefined)
  await restoreRecord($)
  await pruneRecords($, now)
  await recallLimits($, now).catch(() => undefined)
  await flush($, now, true)

  lang = await readLang($)
  await restorePrefs($)
  await readTheme($)
  // What the session already holds when the mod starts sounds nothing.
  heard = heardOf(mem, thresholdsOf(options))

  commandName = await registerCommand($)
  if (isInteractive && options.openOnStart !== false) {
    // A change of options reloads the plugin and this runs again with the pane
    // already open: the power-up sounds only for a pane that was not.
    const before = await $.ui.panes().catch(() => [])
    const wasOpen = before.some(p => p.id === PANE && p.isShown)
    if (!wasOpen) await startBoot($, options)
    void $.ui
      .open({ id: PANE, title: TITLE, columns: columnsOf(options) })
      .then(opened => {
        if (opened.isPlaced && !wasOpen) powerUp($, options)
        // Not placed: no boot is under way; the next opening boots.
        if (!opened.isPlaced && !poweredUp) bootAt = undefined
        return paneMoved($)
      })
      .catch(() => undefined)
  }

  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
}

async function treeCommand($: EngineInterface, args: string, options: Options): Promise<{ text: string }> {
  const word = args.trim().toLowerCase()
  if (word === 'close' || word === 'off' || word === 'hide') {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    await paneMoved($)
    return { text: wordsFor(lang).command.closed }
  }
  const before = await $.ui.panes().catch(() => [])
  const wasOpen = before.some(p => p.id === PANE && p.isShown)
  if (!wasOpen) await startBoot($, options)
  const opened = await $.ui
    .open({ id: PANE, title: TITLE, columns: columnsOf(options), focus: true })
    .catch((err: unknown) => ({ isPlaced: false as const, reason: String(err) }))
  if (opened.isPlaced && !wasOpen) powerUp($, options)
  if (!opened.isPlaced && !poweredUp) bootAt = undefined
  await paneMoved($)
  const said = wordsFor(lang).command
  return { text: opened.isPlaced ? said.opened : said.waits(String(opened.reason)) }
}

function mine(name: string): boolean {
  return commandName === undefined ? name === 'tree' : commandName === name
}

async function pressed($: EngineInterface, press: Press): Promise<void> {
  switch (press.kind) {
    case 'agent': {
      const shown = await $.ui.view({ agentId: press.id }).catch((err: unknown) => ({ deny: String(err) }))
      if (shown.deny) $.ui.toast(`${NAME}: ${shown.deny}`)
      return
    }
    case 'main': {
      await $.ui.view({}).catch(() => undefined)
      return
    }
    case 'finished': {
      // `f` shows or folds every finished agent, every run's too: what the run rows were pressed to goes.
      const u = await update($, uiState, (x: TreeUi): TreeUi => ({ ...x, showFinished: !x.showFinished, openRuns: undefined, closedRuns: undefined }))
      await savePrefs($, u)
      return
    }
    case 'run': {
      const id = press.id
      // The opposite of what it shows now, whatever `f` says.
      await update($, uiState, (u: TreeUi): TreeUi => {
        const opened = (u.openRuns ?? []).filter(x => x !== id)
        const closed = (u.closedRuns ?? []).filter(x => x !== id)
        return runOpen(u, id) ? { ...u, openRuns: opened, closedRuns: [...closed, id] } : { ...u, openRuns: [...opened, id], closedRuns: closed }
      })
      return
    }
    case 'log': {
      const u = await update($, uiState, x => ({ ...x, showLog: !x.showLog }))
      await savePrefs($, u)
      return
    }
    case 'help': {
      await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, view: u.view === 'help' ? 'tree' : 'help', picker: undefined, pickerFor: undefined }))
      return
    }
    case 'options': {
      // The locks read first, so the page draws them at once. The sounds page goes back to the options page.
      await readOptionLocks($).catch(() => undefined)
      await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, view: u.view === 'options' ? 'tree' : 'options', picker: undefined, pickerFor: undefined }))
      return
    }
    case 'sounds': {
      await readOptionLocks($).catch(() => undefined)
      await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, view: u.view === 'sounds' ? 'options' : 'sounds', picker: undefined, pickerFor: undefined }))
      return
    }
    case 'testSound': {
      // To hear it: it plays whatever the switches say.
      void playSound($, press.event).catch(() => undefined)
      return
    }
    case 'option': {
      // As the /config menu would: the engine writes it, and the plugin reloads with it.
      const key = optionKeys[press.field] ?? `${PLUGIN}.${press.field}`
      const result = await $.config.set({ key, value: press.value }).catch((err: unknown) => ({ deny: String(err) }))
      const deny = (result as { deny?: string }).deny
      if (deny) $.ui.toast(`${NAME}: ${deny}`)
      return
    }
    case 'picker': {
      // The HUD unfolds a panel as it opens: its time set before the drawing that brings it.
      const before = await read($, uiState).catch(() => undefined)
      if (!(before?.picker === press.id && before?.pickerFor === press.agentId)) panelAt = await $.clock.now().catch(() => undefined)
      await update($, uiState, (u: TreeUi): TreeUi => {
        const open = u.picker === press.id && u.pickerFor === press.agentId
        // One panel at a time: a choice panel closes the message panel; what was typed stays a draft.
        return { ...u, picker: open ? undefined : press.id, pickerFor: open ? undefined : press.agentId, compose: undefined, composeEffort: undefined }
      })
      return
    }
    case 'close': {
      await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, picker: undefined, pickerFor: undefined, compose: undefined, composeEffort: undefined }))
      return
    }
    case 'compose': {
      const agentId = press.agentId
      composeValue = drafts.get(agentId)
      // The HUD unfolds the message panel as it opens: its time set before the drawing that brings it.
      const before = await read($, uiState).catch(() => undefined)
      if (before?.compose !== agentId) panelAt = await $.clock.now().catch(() => undefined)
      let opened = false
      await update($, uiState, (u: TreeUi): TreeUi => {
        opened = u.compose !== agentId
        // One panel at a time: the message panel closes a choice panel.
        return { ...u, compose: opened ? agentId : undefined, composeEffort: undefined, picker: undefined, pickerFor: undefined }
      })
      // The pane's focus ring onto the field, so typing can start at once:
      // `autoFocus` alone leaves the ring on the ✎ that was pressed. The engine
      // waits for the drawing that brings the field, so nothing is awaited here.
      if (opened) void $.ui.focus({ requestId: PANE, key: fieldKey(agentId) }).catch(() => undefined)
      return
    }
    case 'choose': {
      const chosen = press.value
      if (press.id === 'lang' && isLang(chosen)) await chooseLanguage($, chosen)
      if (press.id === 'model' && offerOf().includes(chosen)) await switchMain($, 'model', chosen)
      if (press.id === 'effort' && (EFFORT_LEVELS as readonly string[]).includes(chosen)) await switchMain($, 'effort', chosen)
      if (press.id === 'advisor' && (chosen === 'off' || ADVISOR_OFFER.includes(chosen))) await switchMain($, 'advisor', chosen)
      if (press.id === 'agentModel' && mem && (chosen === 'auto' || agentOffer(mem).includes(chosen))) await chooseAgents($, { agentModel: chosen })
      if (press.id === 'agentEffort' && (chosen === 'auto' || (EFFORT_LEVELS as readonly string[]).includes(chosen))) {
        await chooseAgents($, { agentEffort: chosen })
      }
      if (press.id === 'runModel') {
        const agentId = (await read($, uiState)).pickerFor
        if (agentId !== undefined && mem && (chosen === 'auto' || agentOffer(mem).includes(chosen))) await chooseRun($, agentId, chosen)
      }
      if (press.id === 'msgEffort' && (chosen === 'auto' || (EFFORT_LEVELS as readonly string[]).includes(chosen))) {
        await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, composeEffort: chosen }))
      }
      return
    }
  }
}

/**
 * The person switched a running subagent's model: its requests from the next
 * one on go with it (turn.step); `auto` gives it back its own. There is no
 * such switch for the effort: a level set mid-run is not carried by the
 * requests that only bring tool results (checked live, plan 02 §7.1).
 */
async function chooseRun($: EngineInterface, agentId: string, value: string): Promise<void> {
  await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, picker: undefined, pickerFor: undefined }))
  change(s => {
    const runModels = { ...(s.choices?.runModels ?? {}) }
    if (value === 'auto') delete runModels[agentId]
    else runModels[agentId] = value
    return withChoices(s, { runModels })
  })
  await flush($, await $.clock.now(), true)
}

/** What the person has typed into the message panel, by agent: kept while the panel is closed. */
const drafts = new Map<string, string>()
/** The text the message field starts from when its panel opens; held while it is open, so a redraw never undoes typing. */
let composeValue: string | undefined

/**
 * The person sent an agent a message from the pane: the effort chosen with it
 * becomes the agent's pin (`auto` gives it back its own), then the message goes
 * ($.session.send). A running agent reads it at its next request; a finished
 * one is resumed with it. Delivered: a log row, the panel closes. Not
 * delivered: a toast says why, and the panel stays open with the text.
 */
async function sendMessage($: EngineInterface, agentId: string, text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  const ui = await read($, uiState)
  const effort = ui.compose === agentId ? ui.composeEffort : undefined
  // The pin is set before the message goes, so the request that carries it
  // already goes with the level (checked live, plan 03).
  let before: PinBefore | undefined
  if (effort !== undefined) {
    change(s => {
      const set = messagePin(s.choices, agentId, effort)
      before = set.before
      return withChoices(s, set.patch)
    })
  }
  const sent = await $.session.send({ to: { agentId }, text: message }).catch((err: unknown) => ({ isDelivered: false as const, reason: String(err) }))
  if (!sent.isDelivered) {
    // Nothing went: the agent's effort goes back to where it stood.
    const back = before
    if (back) change(s => withChoices(s, pinBack(s.choices, agentId, back)))
    // The text stays in the field, a redraw included.
    drafts.set(agentId, text)
    composeValue = text
    $.ui.toast(wordsFor(lang).messageFailed(sent.reason ?? '?'))
    await flush($, await $.clock.now(), true)
    return
  }
  drafts.delete(agentId)
  composeValue = undefined
  note($, (s, now) => messaged(s, agentId, now), true)
  await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, compose: undefined, composeEffort: undefined }))
  await flush($, await $.clock.now(), true)
}

/** What the environment locks: a subagent model forced over every hook, an advisor turned off. */
async function readLocks($: EngineInterface): Promise<void> {
  const forced = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL').catch(() => undefined)
  const disabled = await $.env.get('CLAUDE_CODE_DISABLE_ADVISOR_TOOL').catch(() => undefined)
  const advisorLocked = disabled !== undefined && disabled !== '' && disabled !== '0' && disabled.toLowerCase() !== 'false'
  change(s => withChoices(s, { agentModelForced: forced || undefined, advisorLocked: advisorLocked || undefined }))
}

/**
 * The person picked what new subagents get, for this session: the model
 * their spawn is given, the effort their requests carry (`auto` clears it).
 * Agents already at work keep their own effort. The choice is kept under the
 * session's id, so a /resume brings it back.
 */
async function chooseAgents($: EngineInterface, chosen: { agentModel?: string; agentEffort?: string }): Promise<void> {
  if (!mem) return
  await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, picker: undefined }))
  const working = mem.agents.map(a => a.id)
  change(s => {
    const c = s.choices ?? {}
    const patch: Partial<NonNullable<TreeState['choices']>> = {}
    if (chosen.agentModel !== undefined) patch.agentModel = chosen.agentModel === 'auto' ? undefined : chosen.agentModel
    if (chosen.agentEffort !== undefined) {
      patch.agentEffort = chosen.agentEffort === 'auto' ? undefined : chosen.agentEffort
      patch.exempt = [...new Set([...(c.exempt ?? []), ...working])]
    }
    return withChoices(s, patch)
  })
  await saveRecord($)
  await flush($, await $.clock.now(), true)
}

/** This session's subagent choices into the store, under its id. */
async function saveRecord($: EngineInterface): Promise<void> {
  const id = mem?.sessionId
  if (!mem || id === undefined) return
  const c = mem.choices ?? {}
  const at = await $.clock.now()
  if (c.agentModel === undefined && c.agentEffort === undefined) {
    await $.store.delete(`${RECORD_PREFIX}${id}`).catch(() => undefined)
    return
  }
  await $.store.set(`${RECORD_PREFIX}${id}`, { agentModel: c.agentModel, agentEffort: c.agentEffort, at }).catch(() => undefined)
}

/**
 * The subagent choices kept for the session now in place (a /resume, a
 * restart with --resume): back in force. Agents already listed keep their own
 * effort. A new session has none, so it starts on `auto`.
 */
async function restoreRecord($: EngineInterface): Promise<void> {
  const id = mem?.sessionId
  if (!mem || id === undefined) return
  const record = recordOf(await $.store.get(`${RECORD_PREFIX}${id}`).catch(() => undefined))
  const working = mem.agents.map(a => a.id)
  // The pins a reload kept stay: agents at work keep the effort they started with.
  change(s =>
    withChoices(s, {
      agentModel: record?.agentModel,
      agentEffort: record?.agentEffort,
      exempt: [...new Set([...(s.choices?.exempt ?? []), ...working])],
    }),
  )
}

/** Session records older than a month, or past the newest hundred, are let go. */
async function pruneRecords($: EngineInterface, now: number): Promise<void> {
  const keys = (await $.store.keys().catch(() => [] as string[])).filter(k => k.startsWith(RECORD_PREFIX))
  const records: Array<{ key: string; at: number }> = []
  for (const key of keys) {
    const record = recordOf(await $.store.get(key).catch(() => undefined))
    records.push({ key, at: record?.at ?? 0 })
  }
  for (const key of staleRecords(records, now, RECORD_MS, RECORDS_KEPT)) await $.store.delete(key).catch(() => undefined)
}

/** What `/model` offers: the settings menu's model row, else the plain families. */
function offerOf(): string[] {
  const offer = mem?.choices?.offer
  return offer && offer.length > 0 ? offer : ['default', 'opus', 'sonnet', 'haiku']
}

/**
 * A /model or /effort has run (its hook, once `next(e)` returned): one the pane
 * asked for with these arguments is no longer pending. The pane's own run is
 * not heard here (Claude Code skips a plugin's hooks for what the plugin itself
 * raised: re-entry), so this catches the person typing the same command; the
 * pane's own run lands through the read-back (settle).
 */
function ran(command: 'model' | 'effort', args: string): void {
  const c = mem?.choices
  const asked = command === 'model' ? c?.pendingModel : c?.pendingEffort
  if (asked === undefined || asked !== args.trim()) return
  change(s => withChoices(s, command === 'model' ? { pendingModel: undefined } : { pendingEffort: undefined }))
}

/** The settings menu's model row: what `/model` offers, the model in use as an alias, and whether a policy locks it. */
async function readOffer($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => undefined)
  const row = rows?.find(r => r.key === 'model')
  if (!row || !mem) return
  const offer = (row.options ?? []).filter((o): o is string => typeof o === 'string' && o.length > 0)
  const next = {
    offer: offer.length > 0 ? offer : undefined,
    modelSetting: typeof row.value === 'string' && row.value ? row.value : undefined,
    modelLocked: row.isLocked || undefined,
  }
  const c = mem.choices ?? {}
  if (JSON.stringify([c.offer, c.modelSetting, c.modelLocked]) !== JSON.stringify([next.offer, next.modelSetting, next.modelLocked])) {
    change(s => withChoices(s, next))
  }
}

/**
 * The person picked the session's model or effort: its command runs as if
 * typed (`/model sonnet`, `/effort high`), which Claude Code also saves as the
 * default for new sessions. Until it has taken effect the header shows it
 * pending (`→ Sonnet`); a command that does not run says so in a toast.
 */
async function switchMain($: EngineInterface, command: 'model' | 'effort' | 'advisor', value: string): Promise<void> {
  const now = await $.clock.now()
  const field = command === 'model' ? 'pendingModel' : command === 'effort' ? 'pendingEffort' : 'pendingAdvisor'
  await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, picker: undefined }))
  change(s => withChoices(s, { [field]: value, pendingSince: now }))
  await flush($, now, true)
  const answer = await $.command.run({ command, args: value }).then(
    r => ({ ran: true, text: r.text }),
    () => ({ ran: false, text: undefined }),
  )
  if (!answer.ran) {
    change(s => withChoices(s, { [field]: undefined }))
    $.ui.toast(wordsFor(lang).switchFailed(command, value))
  } else if (answer.text && LANDED[command].test(answer.text)) {
    // Its own answer says it took effect: shown now, whatever the settings read back.
    await landed($, command, value)
  } else if (answer.text && REFUSED.test(answer.text)) {
    // It ran, and said why it changed nothing (`opus can't be used as an advisor`).
    change(s => withChoices(s, { [field]: undefined }))
    $.ui.toast(wordsFor(lang).said(answer.text.split('\n')[0] ?? answer.text))
  }
  await settle($)
  await flush($, await $.clock.now(), true)
}

/** A switch the command's own answer says took effect: no longer pending, the header shows it. */
async function landed($: EngineInterface, command: 'model' | 'effort' | 'advisor', value: string): Promise<void> {
  if (command === 'model') {
    const model = await $.session.model().catch(() => undefined)
    const effort = await configuredEffort($, model)
    await readOffer($)
    change(s => withChoices(mainChanged(s, { model, effort }), { pendingModel: undefined }))
  } else if (command === 'effort') {
    change(s => withChoices(mainChanged(s, { effort: value }), { pendingEffort: undefined }))
  } else {
    change(s => withChoices(advisorSet(s, value === 'off' ? { off: true } : { model: value }), { pendingAdvisor: undefined }))
  }
}

/**
 * Whether a pending /model or /effort has taken effect: the model and the
 * effort read back; what has landed is shown and no longer pending. One still
 * pending after PENDING_MS is given up, with a toast.
 */
async function settle($: EngineInterface): Promise<void> {
  if (!mem) return
  const before = mem.choices ?? {}
  if (before.pendingModel === undefined && before.pendingEffort === undefined && before.pendingAdvisor === undefined) return
  const now = await $.clock.now()
  const model = await $.session.model().catch(() => undefined)
  await readOffer($)
  const effort = await configuredEffort($, model)
  const saved = await $.settings.read({ key: 'advisorModel' }).catch(() => undefined)
  const advisor = typeof saved === 'string' && saved ? saved : null
  const c = mem.choices ?? {}
  const shown = mem.main.effort
  const verdict = pendingSettled(
    c,
    { modelSetting: c.modelSetting, modelAlias: aliasOf(model), effortSaved: effort, effortShown: typeof shown === 'string' ? shown : undefined, advisor },
    now,
    PENDING_MS,
  )
  if (verdict.advisorDone) {
    change(s => withChoices(advisorSet(s, advisor === null ? { off: true } : { model: advisor }), { pendingAdvisor: undefined }))
  }
  if (verdict.modelDone) change(s => withChoices(mainChanged(s, { model, effort }), { pendingModel: undefined }))
  const landed = c.pendingEffort
  if (verdict.effortDone) change(s => withChoices(mainChanged(s, { effort: landed }), { pendingEffort: undefined }))
  if (verdict.givenUp.length > 0) {
    const w = wordsFor(lang)
    for (const g of verdict.givenUp) $.ui.toast(w.notApplied(g.command, g.value))
    change(s => withChoices(s, { pendingModel: undefined, pendingEffort: undefined, pendingAdvisor: undefined, pendingSince: undefined }))
  }
}

/** The person picked a language: the pane speaks it now, and every session after (the store). */
async function chooseLanguage($: EngineInterface, chosen: Lang): Promise<void> {
  lang = chosen
  await update($, uiState, (u: TreeUi): TreeUi => ({ ...u, lang: chosen, picker: undefined }))
  await $.store.set('language', chosen).catch(() => undefined)
  if (commandName !== undefined) {
    const description = wordsFor(chosen).command.description
    await $.command.register({ name: commandName, description, argumentHint: '[close]' }).catch(() => undefined)
  }
}

/** A row's parts in runs: a run of parts with one `key` is one Button, the rest plain text. */
function runs(segs: readonly Seg[]): Array<{ key?: string; press?: Press; segs: Seg[] }> {
  const out: Array<{ key?: string; press?: Press; segs: Seg[] }> = []
  for (const seg of segs) {
    const last = out[out.length - 1]
    if (last && last.key !== undefined && last.key === seg.key) last.segs.push(seg)
    else if (seg.press && seg.key !== undefined) out.push({ key: seg.key, press: seg.press, segs: [seg] })
    else if (last && last.key === undefined) last.segs.push(seg)
    else out.push({ segs: [seg] })
  }
  return out
}

function style(seg: Seg): TextProps {
  const props: TextProps = {}
  if (seg.color !== undefined) props.color = seg.color
  if (seg.dim) props.dimColor = true
  if (seg.bold) props.bold = true
  if (seg.bg !== undefined) props.backgroundColor = seg.bg
  return props
}

export const register: Register = (on, options: Options) => {
  current = options
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await boot($, e.isInteractive, options).catch(() => undefined)
    // After boot, so its toasts speak the pane's language; not awaited.
    void autoUpdate($, e.isInteractive, options).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // Another session takes this one's place: watch for it (see adopt).
    if (e.reason === 'clear' || e.reason === 'resume') {
      watchSwapUntil = (await $.clock.now().catch(() => 0)) + SWAP_WATCH_MS
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    note($, (s, now) => turnStarted(s, e.agentId, e.text, now))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new subagent's requests carry the effort chosen for new subagents: decided
  // from memory, nothing awaited before the request goes on; the agent keeps
  // that level (its pin) whatever is chosen later. A running agent switched in
  // its panel: its model on every request from then on.
  on('turn.step', async function* ($, e, next) {
    const decided = stepEffort(mem?.choices, e.agentId, e.effort)
    const agentId = e.agentId
    const pin = decided.pin
    if (pin !== undefined && agentId !== undefined) change(s => withChoices(s, { pins: { ...(s.choices?.pins ?? {}), [agentId]: pin } }))
    const model = stepModel(mem?.choices, e.agentId, e.model)
    const sent =
      decided.effort !== undefined || model !== undefined
        ? { ...e, ...(decided.effort !== undefined ? { effort: decided.effort as typeof e.effort } : {}), ...(model !== undefined ? { model } : {}) }
        : e
    const result = yield* next(sent)
    try {
      const advisor = (result.serverToolUses ?? [])
        .filter(use => use.name === 'advisor')
        .map(use => ({ startedAt: use.startedAt, endedAt: use.endedAt }))
      const facts = { agentId: e.agentId, model: model !== undefined ? (result.usage?.model ?? model) : e.model, effort: effortText(sent.effort), advisor }
      note($, (s, now) => stepped(s, facts, now), advisor.length > 0)
    } catch {
      // The stream went on whatever the note did.
    }
    return result
  }).catch(async function* ($, e, next) {
    // Replay-safe: hands on what the stream beneath settled to, running nothing twice.
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    note($, (s, now) => turnCompleted(s, { agentId: e.agentId, reason: e.reason }, now), e.agentId !== undefined)
    // A main turn that reached the API: read the context against the turn before.
    if (e.agentId === undefined && e.usage !== undefined) void recordTurn($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => {
    const ran = next(e)
    const input = e as unknown as Readonly<Record<string, unknown>>
    note($, (s, now) => toolCalled(s, e.agentId, String(e.tool), input, now))
    // A workflow run: the tool answers at once (it runs in the background) with
    // the run's id, name, description and task id. Read after `next`, unawaited.
    if (String(e.tool) === 'Workflow') {
      const callerId = e.agentId
      const toolUseId = typeof input.tool_use_id === 'string' && input.tool_use_id ? input.tool_use_id : undefined
      void Promise.resolve(ran).then(
        r => {
          const out = (r as { result?: unknown }).result as { status?: string; runId?: string; taskId?: string; workflowName?: string; summary?: string } | undefined
          if (!out || out.status !== 'async_launched' || !out.runId) return
          const facts: RunFacts = { runId: out.runId, name: out.workflowName, about: out.summary, taskId: out.taskId, toolUseId, callerId }
          note($, (st, now) => runLaunched(st, facts, now), true)
        },
        () => undefined,
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A workflow run's end: its notification, as the main conversation takes it in
  // (when it goes idle, or into its running turn). Passed on unchanged.
  on('prompt.submit', ($, e, next) => {
    // The person's own prompt (typed, from Remote Control, or -p's), not a
    // command's line nor a hidden one: the main row shows it at once, though one
    // typed while a turn runs starts no turn of its own.
    const own = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge' || e.origin?.kind === 'sdk'
    if (own && e.command === undefined && e.isMeta !== true) {
      const text = e.text
      note($, st => prompted(st, text))
    }
    if (e.origin?.kind === 'task-notification') {
      const notices = taskNotices(e.text)
      if (notices.length > 0) note($, (st, now) => notices.reduce((x, n) => runNoticed(x, n, now), st), true)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new subagent is given the model chosen for new subagents (spawnModel says
  // where a spawn takes one); nothing awaited before the spawn goes on.
  on('agent.spawn', async ($, e, next) => {
    const model = spawnModel(mem?.choices, e)
    const result = await next(model !== undefined ? { ...e, model } : e)
    if (result.agentId !== undefined) {
      const facts: SpawnFacts = {
        agentId: result.agentId,
        parentId: e.parentAgentId,
        description: e.description,
        type: e.subagentType,
        name: e.name ?? result.teammateId,
        model: result.model ?? e.model,
        background: e.background,
        fork: e.fork,
        teammate: e.isTeammate === true,
        workflow: e.workflow !== undefined,
        run: e.workflow?.runId || undefined,
        toolUseId: e.tool_use_id || undefined,
      }
      note($, (s, now) => spawned(s, facts, now), true)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', ($, e, next) => {
    const facts = {
      percent: e.context.percent,
      tokens: e.context.tokens,
      window: e.context.window,
      costUsd: e.cost?.usd,
      hasUnknownPrice: e.cost?.hasUnknownPrice === true,
      limits: e.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    }
    note($, (s, now) => measured(s, facts, now))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    note($, (s, now) => compacted(s, e.agentId, now))
    // The main window starts over: its old share is stale until the next reply.
    if (e.agentId === undefined) {
      void $.clock
        .now()
        .then(now => readContext($, now))
        .catch(() => undefined)
    }
    return result
  }).catch(($, e, next) => next(e))

  // The person's /effort and /model: watched, passed on unchanged, drawn at once.
  // The /effort picker sends no argument: the level is read back from where it
  // was saved, the session model's own entry first.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    ran('effort', e.args)
    const model = (await $.session.model().catch(() => undefined)) ?? mem?.main.model
    const effort = effortLevel(e.args) ?? (await configuredEffort($, model))
    if (effort) note($, s => mainChanged(s, { effort }))
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'advisor' }, async ($, e, next) => {
    const result = await next(e)
    const arg = e.args.trim().toLowerCase()
    // `/advisor off`, `/advisor fable`; the picker (no argument) saves to the settings.
    const advisor = arg === 'off' ? { off: true } : arg ? { model: arg } : await advisorSetting($)
    note($, s => advisorSet(s, advisor))
    return result
  }).catch(($, e, next) => next(e))

  // A new model brings the effort saved for it.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    ran('model', e.args)
    const model = await $.session.model().catch(() => undefined)
    const effort = model ? await configuredEffort($, model) : undefined
    if (model) note($, s => mainChanged(s, { model, effort }))
    await readOffer($)
    return result
  }).catch(($, e, next) => next(e))

  const failed = () => ({ text: wordsFor(lang).command.failed })
  on('command.run', { command: 'tree' }, async ($, e, next) => (mine('tree') ? treeCommand($, e.args, options) : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : failed()),
  )
  on('command.run', { command: 'forge-tree' }, async ($, e, next) =>
    mine('forge-tree') ? treeCommand($, e.args, options) : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : failed()))

  // The person closes the pane: the line above the prompt takes over.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) {
      // Closed, it draws nothing more: the idle pace stops until it is drawn again.
      shimmering = false
      await paneMoved($)
    }
    return result
  }).catch(($, e, next) => next(e))

  // While the pane is closed, a line above the prompt sums up the agents, drawn
  // as token-weather draws its own (bandLine). It yields to a survey and to an
  // agent's transcript, as token-weather does.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!bandOn(options) || e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    await read($, paneAtom)
    const panes = await $.ui.panes().catch(() => [])
    if (panes.some(p => p.id === PANE && p.isShown && p.isPlaced)) return next(e)
    const s = await read($, tree)
    const ui = await read($, uiState)
    const f = await read($, frameAtom)
    const line = bandLine(s, e.props.bodyColumns, { frame: f, animate, lang: ui.lang })
    if (line.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text wrap="truncate-end">
        {line.map((part, i) => [
          i > 0 && BAND_GAP,
          <Text {...part.style}>{part.runs?.map(run => <Text {...run.style}>{run.text}</Text>) ?? part.text}</Text>,
        ])}
      </Text>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
    const s = await read($, tree)
    const ui = await read($, uiState)
    const f = await read($, frameAtom)
    const now = await $.clock.now()
    const rows: Row[] = layout(s, ui, {
      cols: e.props.bodyColumns,
      rows: e.props.scroll.bodyRows,
      placement: e.props.placement,
      now,
      frame: f,
      animate,
      logRows: logRowsOf(options),
      draft: composeValue,
      limits: thresholdsOf(options),
      settings: settingsOf(options),
      look: options.hud !== false ? 'hud' : 'classic',
      theme,
      ...(bootAt !== undefined ? { bootAt } : {}),
      ...(panelAt !== undefined ? { openedAt: panelAt } : {}),
    })
    shimmering = hasLiveCell(rows)
    const act = (press: Press) => () => {
      void pressed($, press).catch(() => undefined)
    }
    // A part with an `href` is a link (the repository's, in the help view): a click opens it.
    const texts = (parts: readonly Seg[]) =>
      parts.map(seg =>
        seg.href !== undefined ? (
          <Text {...style(seg)}>
            <Link href={seg.href}>{seg.text}</Link>
          </Text>
        ) : (
          <Text {...style(seg)}>{seg.text}</Text>
        ),
      )
    const segs = (row: { segs: Seg[] }) => texts(row.segs)
    return (
      <Box flexDirection="column">
        {rows.map(row => {
          // A line the field above draws.
          if (row.kind === 'text' && row.covered) return null
          // The message field under the panel's frame, the pane's width, as many
          // lines tall as the row says, its label before it.
          if (row.kind === 'input') {
            const agentId = row.agentId
            return (
              <Box flexDirection="row">
                <Input
                  key={row.key}
                  label={row.label}
                  rows={row.lines}
                  // Blank, the field's width: the engine sizes the field's
                  // clickable box to what it shows, and an empty field with
                  // no placeholder is no cells wide (the hint is in the frame).
                  placeholder={' '.repeat(row.room)}
                  // No word for Enter beside the field (the user's request): the engine still draws its ⏎ while the field has focus.
                  submitLabel=""
                  {...(row.value !== undefined ? { value: row.value } : {})}
                  autoFocus
                  onInput={value => {
                    drafts.set(agentId, value)
                  }}
                  onSubmit={value => {
                    void sendMessage($, agentId, value).catch(() => undefined)
                  }}
                />
              </Box>
            )
          }
          if (row.kind === 'keys') {
            return (
              <Box flexDirection="row" columnGap={2}>
                {row.items.map(item =>
                  isButton(item) ? (
                    <Button key={item.key} plain hotkey={item.hotkey} label={item.label} onPress={act(item.press)} />
                  ) : (
                    <Text dimColor>{item.text}</Text>
                  ),
                )}
              </Box>
            )
          }
          if (row.kind === 'press') {
            return (
              <Button key={row.key} plain onPress={act(row.press)}>
                {segs(row)}
              </Button>
            )
          }
          // A row of text with a part to press (the language sign, a choice): its runs side by side.
          if (row.segs.some(seg => seg.press !== undefined)) {
            return (
              <Box flexDirection="row">
                {runs(row.segs).map(run =>
                  run.press !== undefined && run.key !== undefined ? (
                    <Button key={run.key} plain onPress={act(run.press)}>
                      {texts(run.segs)}
                    </Button>
                  ) : (
                    <Text wrap="truncate">{texts(run.segs)}</Text>
                  ),
                )}
              </Box>
            )
          }
          return <Text wrap="truncate">{segs(row)}</Text>
        })}
      </Box>
    )
  }).catch(($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{wordsFor(lang).command.drawFailed}</Text>
  })
}
