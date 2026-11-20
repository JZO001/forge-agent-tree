import { expect, mock, test as kitTest } from 'claude-code/testing'
import type { Engine, TestBody, TestOptions } from 'claude-code/testing'
import type { AgentInfo, On, SessionUsage, SessionUsageArgs } from 'claude-code'

import { OFFER } from './fixture'

/**
 * The pane's tests read the classic look (the Forge HUD is the default, plan 08):
 * each test gets `hud: false` unless its own options say otherwise; the HUD's own
 * tests set `hud: true`.
 */
function test(name: string, a: TestOptions | TestBody, b?: TestBody): void {
  if (typeof a === 'function') kitTest(name, { options: { hud: false } }, a)
  else kitTest(name, { ...a, options: { hud: false, ...(a.options ?? {}) } }, b!)
}

const T0 = Date.UTC(2026, 10, 18, 13, 0, 0)

function pane(cols: number) {
  return {
    plugin: 'forge-agent-tree',
    component: 'Pane',
    requestId: 'forge-tree',
    props: {
      title: 'Agent Tree // Forge',
      isFocused: false,
      bodyColumns: cols,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const
}

/** The engine beneath the mod: a session on Opus with one Haiku explorer. Every hook
 * beneath is registered before the first call on `$`, as the kit requires. */
type World = {
  id: string
  model: string
  /** The status line's share: absent until a response of the window measured it. */
  percent?: number
  /** What a local breakdown estimates the window holds. */
  estimate?: number
  /** The settings as the engine merged them. */
  settings?: Record<string, unknown>
  /** What the plugin's store holds at the start; English chosen when not given, so the machine's language never shows. */
  store?: Record<string, unknown>
  /** The settings menu's model row value: the model in use, as an alias. */
  modelSetting?: string
  /** A command run beneath fails, as one Claude Code refuses. */
  refuse?: boolean
  /** A command run beneath waits for this, as one Claude Code queues until it is idle. */
  queue?: Promise<void>
  /** The models `/advisor` refuses, as Claude Code does one that cannot advise. */
  noAdvisor?: string[]
  /** `/advisor` answers that it set the advisor but writes no setting, as a flag-settings path may. */
  advisorUnsaved?: boolean
  /** The system the session runs on, as `uname -s` names it. */
  sysname?: string
  /** The plugin's open panes, as the engine lists them. */
  panes?: Array<{ id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }>
  /** A message sent to an agent is not delivered, for this reason. */
  undeliverable?: string
  /** What the Workflow tool answers beneath: a run launched in the background. */
  workflow?: { runId: string; taskId: string; workflowName: string; summary: string }
  /** The mod's options a policy locks, as /config lists them. */
  lockedOptions?: string[]
  /** The environment the mod reads; nothing set when not given. */
  env?: Record<string, string>
  /**
   * The mod's own update beneath: the version `claude plugin list` shows (and
   * the install's id), the one GitHub's plugin.json holds, and the update
   * command's exit code (0 installs the newer one).
   */
  update?: { id?: string; installed?: string; latest?: string; exit?: number }
  /** The plugin's folder, as `$.process.hookEnv()` names it (`CLAUDE_PLUGIN_ROOT`); none when not given. */
  pluginRoot?: string
  /** The session is interactive (a terminal); `false` for a `claude -p` run. */
  interactive?: boolean
  /** How a sound player exits (0 played it). */
  playerExit?: number
  /** The server tools a model step used; an advisor call when not given. */
  serverTools?: Array<{ id: string; name: string; input: Record<string, never>; startedAt: number; endedAt?: number }>
  /** How /config keys the mod's options: `forge-agent-tree.` when not given. */
  optionPrefix?: string
  /** The mod's options /config lists unlocked (with the prefix), besides the locked ones. */
  listedOptions?: string[]
  /** /config refuses to set an option, for this reason. */
  configRefuse?: string
  /** How the Workflow tool answers: launched here in the background, unless the world says otherwise (`remote_launched`). */
  workflowStatus?: string
  /** No rate limits (an API key, a fresh install): no countdown in the pane. */
  noLimits?: boolean
  /** `claude` starts only through cmd.exe (an npm install's `claude.cmd` on Windows): run by itself it cannot start. */
  claudeViaCmd?: boolean
}


const MODEL_IDS: Readonly<Record<string, string>> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }

function usageOf(world: World, args: SessionUsageArgs | undefined): SessionUsage {
  const usage: SessionUsage = {
    startedAt: T0,
    context: { window: 200_000, percent: world.percent, tokens: world.percent === undefined ? undefined : world.percent * 2000 },
    rateLimits: world.noLimits ? [] : [{ kind: 'five_hour', percentUsed: 23, resetsAt: new Date(T0 + 3 * 3_600_000).toISOString() }],
    cost: { usd: 0.42 },
  }
  if (args?.breakdown && world.estimate !== undefined) {
    // Only the fields the mod reads; the rest of a breakdown is the engine's.
    usage.context.breakdown = { totalTokens: world.estimate, rawMaxTokens: 200_000 } as unknown as NonNullable<SessionUsage['context']['breakdown']>
  }
  return usage
}

async function session($: Engine, on: On, agents: AgentInfo[] = [], world: World = { id: 's1', model: 'claude-opus-5-5' }) {
  const clock = mock.clock(on, { now: T0 })
  // The plugin's store, in memory, for the test to read what the mod kept.
  const stored = new Map<string, unknown>(Object.entries(world.store ?? { language: 'en' }))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  const viewed: unknown[] = []
  on('session.model', () => ({ value: world.model }))
  on('session.id', () => ({ value: world.id }))
  on('settings.read', () => ({ value: world.settings ?? {} }))
  // Claude Code beneath: /model and /effort switch and save as typed ones do.
  const commands: Array<{ command: string; args: string }> = []
  on('command.run', async (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (world.queue) await world.queue
    if (world.refuse) throw new Error('refused')
    if (e.command === 'model' && MODEL_IDS[e.args]) {
      world.model = MODEL_IDS[e.args]!
      world.modelSetting = e.args
    }
    if (e.command === 'effort' && e.args) {
      const saved = (world.settings?.modelSettings ?? {}) as Record<string, unknown>
      world.settings = { ...world.settings, modelSettings: { ...saved, [world.model]: { effortLevel: e.args } } }
    }
    if (e.command === 'advisor') {
      if ((world.noAdvisor ?? []).includes(e.args)) return { text: `${e.args} can't be used as an advisor. Options: fable, opus, off` }
      const { advisorModel: _gone, ...rest } = world.settings ?? {}
      if (!world.advisorUnsaved) world.settings = e.args === 'off' ? rest : { ...rest, advisorModel: e.args }
      return { text: e.args === 'off' ? 'Advisor disabled' : `Advisor set to ${e.args}` }
    }
    return {}
  })
  on('ui.panes', () => ({ value: world.panes ?? [] }))
  // Sound beneath: what was played, and what was run to play it.
  const sounds: string[] = []
  on('session.machine', () => ({ value: { sysname: world.sysname ?? 'Linux', release: '', machine: 'x86_64', packageManagers: [], runtimes: [] } }))
  on('audio.play', (_, e) => {
    sounds.push(`play ${e.clip.asset ?? '?'}`)
    return { value: undefined }
  })
  const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  // The `claude` command beneath, for the mod's own update: what it ran.
  const updates: string[] = []
  on('process.run', (_, e) => {
    const viaCmd = e.argv[0] === 'cmd.exe' && e.argv[1] === '/d' && e.argv[2] === '/c'
    const argv = viaCmd ? e.argv.slice(3) : e.argv
    if (argv[0] === 'claude') {
      updates.push(e.argv.join(' '))
      // an npm install on Windows: `claude` alone is not found
      if (world.claudeViaCmd && !viaCmd) throw new Error('spawn claude ENOENT')
      const u = world.update
      if (argv[2] === 'list') {
        const id = u?.id ?? 'forge-agent-tree@forge-agent-tree'
        return ran(JSON.stringify(u?.installed === undefined ? [] : [{ id, version: u.installed, scope: 'user', enabled: true }]))
      }
      if (argv[2] === 'update') {
        const code = u?.exit ?? 0
        if (u && code === 0 && u.latest !== undefined) u.installed = u.latest
        return ran('', code)
      }
      return ran('')
    }
    sounds.push(`run ${e.argv.join(' ')}`)
    return ran('', world.playerExit ?? 0)
  })
  // GitHub beneath: the plugin.json of the repository's main branch.
  const fetched: string[] = []
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    const latest = world.update?.latest
    return {
      value: latest === undefined ? { status: 404, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: 'forge-agent-tree', version: latest }) },
    }
  })
  mock.env(on, world.env ?? {})
  on('process.hookEnv', () => ({ value: (world.pluginRoot ? { CLAUDE_PLUGIN_ROOT: world.pluginRoot } : {}) as Record<string, string> }))
  on('config.list', () => ({
    value: [
      { key: 'model', label: 'Model', kind: 'choice' as const, value: world.modelSetting ?? 'opus', options: OFFER, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
      // the mod's own options, as /config lists them: `<plugin>.<field>`
      ...[...(world.lockedOptions ?? []), ...(world.listedOptions ?? [])].map(field => ({
        key: `${world.optionPrefix ?? 'forge-agent-tree.'}${field}`,
        label: field,
        kind: 'boolean' as const,
        value: false,
        provider: { plugin: 'forge-agent-tree', tier: 'user' as const },
        isLocked: (world.lockedOptions ?? []).includes(field),
      })),
    ],
  }))
  // The settings menu beneath: what the mod set, as the person would in /config.
  const configSets: Array<{ key: string; value: unknown }> = []
  on('config.set', (_, e) => {
    configSets.push({ key: e.key, value: e.value })
    if (world.configRefuse) return { deny: world.configRefuse }
    return { value: e.value }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  // Messages to agents beneath: whom and what, delivered unless the world says not.
  const sent: Array<{ to: unknown; text: string }> = []
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return world.undeliverable ? { isDelivered: false as const, reason: world.undeliverable } : { isDelivered: true as const }
  })
  on('session.usage', (_, e) => ({ value: usageOf(world, e as SessionUsageArgs | undefined) }))
  on('agent.list', () => ({ value: agents }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // The pane opened and closed beneath: what the mod asked for.
  const opens: unknown[] = []
  on('ui.open', (_, e) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  const closes: unknown[] = []
  on('ui.close', (_, e) => {
    closes.push(e)
    return { value: undefined }
  })
  on('ui.view', (_, e) => {
    viewed.push(e)
    return { value: {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Beneath the spawns and the steps: what reached them, after the mod's hooks.
  const spawns: Array<{ model?: string; fork: boolean }> = []
  on('agent.spawn', (_, e) => {
    spawns.push({ model: e.model, fork: e.fork })
    return { model: e.model === 'haiku' ? 'claude-haiku-5-5' : (e.model ?? 'claude-haiku-5-5'), agentId: `a${spawns.length}` }
  })
  const steps: Array<{ agentId?: string; effort?: unknown }> = []
  // The Workflow tool answers at once with the run it launched; any other tool with nothing.
  on('tool.call', (_, e) => (String(e.tool) === 'Workflow' && world.workflow ? { result: { status: world.workflowStatus ?? 'async_launched', ...world.workflow } as never } : { result: {} }))
  // The main conversation takes in a prompt or a notification as it came.
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  // A reply's figures and a compaction, as the engine raises them after a response.
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const stepModels: Array<{ agentId?: string; model: string }> = []
  on('turn.step', async function* (_, e) {
    steps.push({ agentId: e.agentId, effort: e.effort })
    stepModels.push({ agentId: e.agentId, model: e.model })
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      serverToolUses: world.serverTools ?? [{ id: 's1', name: 'advisor', input: {}, startedAt: T0 + 100, endedAt: T0 + 4200 }],
      stopReason: 'end_turn' as const,
      usage: null,
    }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: world.interactive ?? true })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'find the auth handlers',
    description: 'Find auth handlers',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  await $.tool.call({ tool: 'Grep', pattern: 'src/auth/**', agentId: 'a1' })
  await clock.advance(1000)
  return { clock, viewed, stored, commands, toasts, spawns, steps, stepModels, sounds, sent, configSets, updates, fetched, opens, closes }
}

/** Waits, in real time, until `done` holds (the mod's update runs unawaited), or `ms` pass. */
async function until(done: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout
  while (!done() && Date.now() < end) await new Promise<void>(resolve => later(resolve, 5))
}

/** One model request, run to its end: the main loop's, or an agent's. */
async function step($: Engine, agentId: string | undefined, effort: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't9', index: 1, model: 'claude-sonnet-5-5', effort: effort as 'high', messageCount: 4, ...(agentId ? { agentId } : {}) })
  for await (const _chunk of stream) {
    // drained: the mod forwards every chunk
  }
}

async function spawn($: Engine, extra: { fork?: boolean; model?: string } = {}): Promise<void> {
  await $.agent.spawn({
    tool_use_id: 'tu9',
    prompt: 'check the routes',
    description: 'Check routes',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: extra.fork ?? false,
    ...(extra.model ? { model: extra.model } : {}),
  })
}

test('a spawned agent shows up with its model and what it does, on every surface', async ($, on) => {
  await session($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(56), surface })
    expect(await ui.find({ text: /Find auth handlers/ })).toBeDefined()
    expect(await ui.find({ text: /Haiku 5\.5/ })).toBeDefined()
    expect(await ui.find({ text: /Grep src\/auth/ })).toBeDefined()
    expect(await ui.find({ text: /Opus 5\.5/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing an agent row puts its transcript in view', async ($, on) => {
  const { viewed } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'agent:a1' })
  expect(viewed).toEqual([expect.objectContaining({ agentId: 'a1' })])
  await ui.unmount()
})

test('the help key opens the legend and goes back', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-help' })
  expect(await ui.find({ text: /Legend/ })).toBeDefined()
  // the repository, as a link a click opens
  expect(JSON.stringify(await ui.drawn())).toMatch(/"type":"Link","props":\{"href":"https:\/\/github\.com\/JZO001\/forge-agent-tree"/)
  await ui.press({ key: 'key-help' })
  expect(await ui.find({ text: /Legend/ })).toBeUndefined()
  expect(await ui.find({ text: /Find auth handlers/ })).toBeDefined()
  await ui.unmount()
})

test('an advisor call in a model step reaches the advisor row', async ($, on) => {
  const { clock } = await session($, on)
  const stream = $.turn.step({ turnId: 'turn1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
  for await (const _chunk of stream) {
    // drain the stream: the mod forwards every chunk
  }
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /◆ × 1/ })).toBeDefined()
  expect(await ui.find({ text: /4\.1s/ })).toBeDefined()
  await ui.unmount()
})

test('the finished toggle and an agent turn end', async ($, on) => {
  const { clock } = await session($, on)
  await $.turn.complete({ answer: 'found them', durationMs: 4000, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /✓/ })).toBeDefined()
  expect(await ui.find({ text: /done · 1 tool/ })).toBeDefined()
  await ui.unmount()
})

test('the agent list fills in what an agent has used of its context', async ($, on) => {
  const a1: AgentInfo = {
    id: 'a1',
    description: 'Find auth handlers',
    type: 'Explore',
    status: 'running',
    kind: 'local_agent',
    taskStatus: 'running',
    label: 'Searching the auth handlers',
    startTime: T0,
    cwd: '/',
    model: 'claude-haiku-5-5',
    contextWindowSize: 116_000,
    tokenCount: 21_000,
    tokenSamples: [5_000, 21_000],
    hasRow: true,
  }
  await session($, on, [a1])
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /ctx ☀  ▉░░░░ 18%/ })).toBeDefined()
  await ui.unmount()
})

test('a /resume puts the session now in place in the pane, with its own model', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5' }
  const { clock } = await session($, on, [], world)
  // The session swaps under the process: no session.start follows, only this end.
  world.id = 's2'
  world.model = 'claude-sonnet-5-5'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /● ▾Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ text: /team {2}Sonnet × 1/ })).toBeDefined()
  expect(await ui.find({ text: /Find auth handlers/ })).toBeUndefined()
  await ui.unmount()
})

test('the context shows right after the start, as an estimate until a reply measures it', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', estimate: 24_000 }
  const { clock } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /ctx +☀  █▎░+ ~12%/ })).toBeDefined()
  expect(await ui.find({ text: /≈\$0\.42/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(100)
})

test('a window a reply has measured shows its share at once, with no ~', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', percent: 47, estimate: 24_000 }
  await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /ctx +☁  ████▊░+ 47%/ })).toBeDefined()
  expect(await ui.find({ text: /~\d+%/ })).toBeUndefined()
  await ui.unmount()
})

test('a main turn that ends shows how the context changed over it', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', percent: 10 }
  const { clock } = await session($, on, [], world)
  world.percent = 12
  const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await $.turn.complete({ answer: 'done', durationMs: 900, isAborted: false, turnId: 't2', reason: 'answer', usage })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /24\.0k \/ 200k {2}▲ \+4\.0k last turn/ })).toBeDefined()
  await ui.unmount()
})

test('the session limit shows with its reset, and its countdown moves while nothing works', async ($, on) => {
  const { clock } = await session($, on)
  // the explorer is done: nothing works, the pane is idle
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  const before = (await ui.find({ text: /^session .* 23% .*in \dh\d\dm$/ }))?.text
  expect(before).toBeDefined()
  await clock.advance(3 * 60_000)
  const after = (await ui.find({ text: /^session .* 23% .*in \dh\d\dm$/ }))?.text
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  await ui.unmount()
})

test('idle, the light keeps running along a bar of three full cells', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', percent: 47 }
  const { clock } = await session($, on, [], world)
  // the explorer ends: nothing works any more
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  // the light's cell: the text length of the parts before it in the ctx row
  const lightAt = async () => {
    const texts = await ui.findAll({ type: 'Text' })
    const row = texts.find(t => /^ctx +☁  /.test(t.text))
    let cells = 0
    for (const c of row?.children ?? []) {
      const part = c as { props?: { color?: string }; children?: unknown[] }
      if (part.props?.color === 'cyanBright') return cells
      cells += String(part.children?.[0] ?? '').length
    }
    return -1
  }
  const first = await lightAt()
  expect(first >= 0).toBe(true)
  await clock.advance(250)
  const second = await lightAt()
  await clock.advance(250)
  const third = await lightAt()
  // the light cell moves along the fill: the row's parts change as it goes
  expect(new Set([first, second, third]).size > 1).toBe(true)
  await ui.unmount()
})

/** A command the person typed at the prompt of a fullscreen terminal. */
const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

test('the /effort picker sends no level: the level saved for the session model shows', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-sonnet-5-5', settings: { effortLevel: 'xhigh' } }
  const { clock } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾Sonnet 5\.5 · ▾xhigh/ })).toBeDefined()
  world.settings = { effortLevel: 'xhigh', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'high' } } }
  await $.command.run({ command: 'effort', args: '', ...typed })
  await clock.advance(500)
  expect(await ui.find({ text: /▾Sonnet 5\.5 · ▾high/ })).toBeDefined()
  await ui.unmount()
})

test('a /model switch brings the effort saved for the new model', async ($, on) => {
  const world: World = {
    id: 's1',
    model: 'claude-opus-5-5',
    settings: { effortLevel: 'xhigh', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } },
  }
  const { clock } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾Opus 5\.5 · ▾xhigh/ })).toBeDefined()
  world.model = 'claude-sonnet-5-5'
  await $.command.run({ command: 'model', args: 'sonnet', ...typed })
  await clock.advance(500)
  expect(await ui.find({ text: /▾Sonnet 5\.5 · ▾low/ })).toBeDefined()
  await ui.unmount()
})

test('▾en opens the language panel; Magyar switches the pane, is kept for later sessions, and closes the panel', async ($, on) => {
  const { stored } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾en/ })).toBeDefined()
  expect(await ui.find({ text: /Choose language/ })).toBeUndefined()
  await ui.press({ key: 'picker:lang' })
  expect(await ui.find({ text: /Choose language/ })).toBeDefined()
  await ui.press({ key: 'choose:lang:hu' })
  expect(stored.get('language')).toBe('hu')
  expect(await ui.find({ text: /Choose language|Válassz nyelvet/ })).toBeUndefined()
  expect(await ui.find({ text: /▾hu/ })).toBeDefined()
  expect(await ui.find({ text: /csapat/ })).toBeDefined()
  await ui.unmount()
})

test('× and the sign again close the panel, choosing nothing', async ($, on) => {
  const { stored } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:lang' })
  await ui.press({ key: 'close:lang' })
  expect(await ui.find({ text: /Choose language/ })).toBeUndefined()
  await ui.press({ key: 'picker:lang' })
  await ui.press({ key: 'picker:lang' })
  expect(await ui.find({ text: /Choose language/ })).toBeUndefined()
  expect(stored.get('language')).toBe('en')
  await ui.unmount()
})

test('a language chosen in an earlier session is spoken from the start', async ($, on) => {
  await session($, on, [], { id: 's1', model: 'claude-opus-5-5', store: { language: 'hu' } })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾hu/ })).toBeDefined()
  expect(await ui.find({ text: /csapat/ })).toBeDefined()
  await ui.unmount()
})

test("with no choice saved, Claude Code's language setting decides; a reading is not saved", async ($, on) => {
  const { stored } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', settings: { language: 'Hungarian' }, store: {} })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾hu/ })).toBeDefined()
  expect(stored.get('language')).toBeUndefined()
  await ui.unmount()
})

test('after a /resume the new session speaks the chosen language too', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', store: { language: 'hu' } }
  const { clock } = await session($, on, [], world)
  world.id = 's2'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /▾hu/ })).toBeDefined()
  expect(await ui.find({ text: /csapat/ })).toBeDefined()
  await ui.unmount()
})

test('on the desktop the sign and the panel draw and press too', async ($, on) => {
  const { stored } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'desktop' })
  await ui.press({ key: 'picker:lang' })
  expect(await ui.find({ text: /Choose language/ })).toBeDefined()
  await ui.press({ key: 'choose:lang:hu' })
  expect(stored.get('language')).toBe('hu')
  await ui.unmount()
})

test('the model panel runs /model as typed; the header shows the new model once it has taken effect', async ($, on) => {
  const { clock, commands } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:model' })
  expect(await ui.find({ text: /Session model/ })).toBeDefined()
  expect(await ui.find({ text: /also saved as the default for new sessions/ })).toBeDefined()
  await ui.press({ key: 'choose:model:sonnet' })
  await clock.advance(500)
  expect(commands).toContainEqual({ command: 'model', args: 'sonnet' })
  expect(await ui.find({ text: /Session model/ })).toBeUndefined()
  expect(await ui.find({ text: /● ▾Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  await ui.unmount()
})

test('the effort panel runs /effort as typed, and the level shows', async ($, on) => {
  const { clock, commands } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:effort' })
  await ui.press({ key: 'choose:effort:low' })
  await clock.advance(500)
  expect(commands).toContainEqual({ command: 'effort', args: 'low' })
  expect(await ui.find({ text: /▾Opus 5\.5 · ▾low/ })).toBeDefined()
  await ui.unmount()
})

test('a switch Claude Code refuses says so, and nothing stays pending', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', refuse: true }
  const { clock, toasts } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:model' })
  await ui.press({ key: 'choose:model:haiku' })
  await clock.advance(500)
  expect(toasts.some(t => t.includes('/model haiku did not run'))).toBe(true)
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  expect(await ui.find({ text: /● ▾Opus 5\.5/ })).toBeDefined()
  await ui.unmount()
})

test('a switch queued until Claude is idle shows pending, then the new model once it has run', async ($, on) => {
  let release = () => {}
  const world: World = { id: 's1', model: 'claude-opus-5-5', queue: new Promise<void>(r => (release = r)) }
  const { clock, commands } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:model' })
  await ui.press({ key: 'choose:model:sonnet' })
  await clock.advance(500)
  expect(commands).toContainEqual({ command: 'model', args: 'sonnet' })
  expect(await ui.find({ text: /● ▾Opus 5\.5 → Sonnet/ })).toBeDefined()
  release()
  await clock.advance(3500)
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  expect(await ui.find({ text: /● ▾Sonnet 5\.5/ })).toBeDefined()
  await ui.unmount()
})


test('the advisor panel runs /advisor as typed; off shows off', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', settings: { advisorModel: 'fable' } }
  const { clock, commands } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /◆ ▾Fable advisor/ })).toBeDefined()
  await ui.press({ key: 'picker:advisor' })
  expect(await ui.find({ text: /╭─ Advisor/ })).toBeDefined()
  await ui.press({ key: 'choose:advisor:off' })
  await clock.advance(500)
  expect(commands).toContainEqual({ command: 'advisor', args: 'off' })
  expect(await ui.find({ text: /◆ ▾advisor · off/ })).toBeDefined()
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  await ui.unmount()
})

test("a model /advisor will not take: Claude Code's answer in a toast, nothing pending", async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', settings: { advisorModel: 'fable' }, noAdvisor: ['sonnet'] }
  const { clock, toasts } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:advisor' })
  await ui.press({ key: 'choose:advisor:sonnet' })
  await clock.advance(500)
  expect(toasts.some(t => t.includes("sonnet can't be used as an advisor"))).toBe(true)
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  expect(await ui.find({ text: /◆ ▾Fable advisor/ })).toBeDefined()
  await ui.unmount()
})

test('with nothing chosen, a spawn and its steps go on as they came', async ($, on) => {
  const { spawns, steps } = await session($, on)
  await spawn($)
  await step($, 'a2', 'high')
  expect(spawns.map(x => x.model)).toEqual([undefined, undefined])
  expect(steps).toEqual([{ agentId: 'a2', effort: 'high' }])
})

test('a model chosen for new subagents: their spawn is given it, a fork is not; the choice is kept for the session', async ($, on) => {
  const { clock, spawns, stored } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:agentModel' })
  expect(await ui.find({ text: /Model for new subagents/ })).toBeDefined()
  await ui.press({ key: 'choose:agentModel:haiku' })
  await clock.advance(500)
  expect(await ui.find({ text: /agents {2}model: ▾Haiku/ })).toBeDefined()
  await spawn($, { model: 'opus' })
  await spawn($, { fork: true })
  expect(spawns.slice(1).map(x => x.model)).toEqual(['haiku', undefined])
  expect(stored.get('session:s1')).toMatchObject({ agentModel: 'haiku' })
  await ui.unmount()
})

test('an effort chosen for new subagents: new agents\' requests carry it, those at work and the main loop keep theirs', async ($, on) => {
  const { clock, steps } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await clock.advance(500)
  await ui.press({ key: 'picker:agentEffort' })
  await ui.press({ key: 'choose:agentEffort:low' })
  await clock.advance(500)
  expect(await ui.find({ text: /effort: ▾low/ })).toBeDefined()
  await spawn($)
  await step($, 'a2', 'high')
  await step($, 'a1', 'high')
  await step($, undefined, 'xhigh')
  expect(steps).toEqual([
    { agentId: 'a2', effort: 'low' },
    { agentId: 'a1', effort: 'high' },
    { agentId: undefined, effort: 'xhigh' },
  ])
  // back to auto: the agent that started on low keeps it
  await ui.press({ key: 'picker:agentEffort' })
  await ui.press({ key: 'choose:agentEffort:auto' })
  await clock.advance(500)
  await step($, 'a2', 'high')
  expect(steps[steps.length - 1]).toEqual({ agentId: 'a2', effort: 'low' })
  await ui.unmount()
})

test('after a /resume the session in place gets its own subagent choices back', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', store: { language: 'en', 'session:s2': { agentModel: 'sonnet', agentEffort: 'max', at: T0 } } }
  const { clock, spawns } = await session($, on, [], world)
  world.id = 's2'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /agents {2}model: ▾Sonnet {3}effort: ▾max/ })).toBeDefined()
  await spawn($)
  expect(spawns[spawns.length - 1]?.model).toBe('sonnet')
  await ui.unmount()
})

test("an advisor switch the answer says took effect shows at once, though no setting was written", async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', settings: { advisorModel: 'fable' }, advisorUnsaved: true }
  const { clock, toasts } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:advisor' })
  await ui.press({ key: 'choose:advisor:opus' })
  await clock.advance(500)
  expect(await ui.find({ text: /→/ })).toBeUndefined()
  expect(await ui.find({ text: /◆ ▾Opus advisor/ })).toBeDefined()
  expect(toasts).toEqual([])
  await ui.unmount()
})

test("a running agent switched to another model: its next requests go with it, the main loop's do not", async ($, on) => {
  const { clock, stepModels } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:runModel:a1' })
  expect(await ui.find({ text: /Find auth handlers · model/ })).toBeDefined()
  await ui.press({ key: 'choose:runModel:opus' })
  await clock.advance(500)
  expect(await ui.find({ text: /▾→Opus/ })).toBeDefined()
  await step($, 'a1', 'high')
  await step($, undefined, 'high')
  expect(stepModels).toEqual([
    { agentId: 'a1', model: 'opus' },
    { agentId: undefined, model: 'claude-sonnet-5-5' },
  ])
  await clock.advance(500)
  expect(await ui.find({ text: /▾→Opus/ })).toBeUndefined()
  await ui.unmount()
})


test('a message from the pane: ✎ opens its panel at the foot, Enter sends it, the panel closes and the log says so', async ($, on) => {
  const { clock, sent } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  expect(await ui.find({ text: /✎ Message to Find auth handlers/ })).toBeDefined()
  // in the keys' place
  expect(await ui.find({ key: 'key-help' })).toBeUndefined()
  // the field is three lines, under the frame, its label before it; the hint is the frame's;
  // the field's placeholder is blank, as wide as the field, so a click anywhere on it reaches it
  const drawn = JSON.stringify(await ui.drawn())
  // blank, the room after the label (47) less the engine's hint while focused (22) and the cursor's cell (the user's live check of 2026-11-20)
  expect(drawn).toContain(`"placeholder":"${' '.repeat(24)}"`)
  expect(drawn).toContain('Type your message below')
  expect(drawn).toMatch(/"type":"Input","props":\{[^}]*"label":"message"/)
  expect(drawn).toMatch(/"type":"Input","props":\{[^}]*"rows":3/)
  // no word for Enter beside it: an empty label, else the engine says "submit"
  expect(drawn).toMatch(/"type":"Input","props":\{[^}]*"submitLabel":""/)
  await ui.input({ key: 'message:a1', text: '  look in lib/ too  ' })
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toBe('look in lib/ too')
  expect(JSON.stringify(sent[0]?.to)).toContain('a1')
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to/ })).toBeUndefined()
  expect(await ui.find({ key: 'key-help' })).toBeDefined()
  expect(await ui.find({ text: /message sent/ })).toBeDefined()
  await ui.unmount()
})

test('an empty message is not sent; ✎ again, or ×, closes the panel', async ($, on) => {
  const { clock, sent } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.input({ key: 'message:a1', text: '   ' })
  expect(sent).toHaveLength(0)
  expect(await ui.find({ text: /✎ Message to/ })).toBeDefined()
  await ui.press({ key: 'compose:a1' })
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to/ })).toBeUndefined()
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'close:msgEffort' })
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to/ })).toBeUndefined()
  await ui.unmount()
})

test("the effort chosen with a message goes with the agent's next requests; the main loop's keep theirs", async ($, on) => {
  const { clock, steps, sent } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'choose:msgEffort:max' })
  // choosing keeps the panel open, for the message
  expect(await ui.find({ text: /✎ Message to Find auth handlers/ })).toBeDefined()
  await ui.input({ key: 'message:a1', text: 'think harder' })
  expect(sent).toHaveLength(1)
  await step($, 'a1', 'high')
  await step($, undefined, 'high')
  expect(steps.slice(-2)).toEqual([
    { agentId: 'a1', effort: 'max' },
    { agentId: undefined, effort: 'high' },
  ])
  // auto gives it back its own
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'choose:msgEffort:auto' })
  await ui.input({ key: 'message:a1', text: 'as you were' })
  await step($, 'a1', 'high')
  expect(steps.at(-1)).toEqual({ agentId: 'a1', effort: 'high' })
  // and a level after auto holds again
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'choose:msgEffort:low' })
  await ui.input({ key: 'message:a1', text: 'quick now' })
  await step($, 'a1', 'high')
  expect(steps.at(-1)).toEqual({ agentId: 'a1', effort: 'low' })
  await clock.advance(500)
  await ui.unmount()
})

test('a message not delivered: a toast says why, the panel stays open with the text, the effort stays as it was', async ($, on) => {
  const { clock, toasts, steps } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', undeliverable: 'no agent by that id' })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'choose:msgEffort:max' })
  await ui.input({ key: 'message:a1', text: 'look in lib/ too' })
  await step($, 'a1', 'high')
  expect(steps.at(-1)).toEqual({ agentId: 'a1', effort: 'high' })
  expect(toasts.join('\n')).toContain('the message was not delivered: no agent by that id')
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to Find auth handlers/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('look in lib/ too')
  expect(await ui.find({ text: /message sent/ })).toBeUndefined()
  await ui.unmount()
})

test('what is typed survives the ticker\'s redraws, a draft given back included', async ($, on) => {
  const { clock } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.input({ key: 'message:a1', text: 'first', kind: 'change' })
  await ui.press({ key: 'compose:a1' })
  await ui.press({ key: 'compose:a1' })
  await clock.advance(500)
  // the draft is given back as the field's value, and typing goes on over it
  await ui.input({ key: 'message:a1', text: 'first and more', kind: 'change' })
  await clock.advance(1000)
  // While the panel is open every redraw draws the same value, so the engine
  // never replaces what is being typed (`InputProps.value`: typing holds
  // until the hook draws another).
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"value":"first"')
  expect(drawn).not.toContain('"value":"first and more"')
  await ui.unmount()
})

test('a choice panel closes the message panel; what was typed comes back when it opens again', async ($, on) => {
  const { clock } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.input({ key: 'message:a1', text: 'half a thought', kind: 'change' })
  await ui.press({ key: 'picker:lang' })
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to/ })).toBeUndefined()
  expect(await ui.find({ text: /Choose language/ })).toBeDefined()
  await ui.press({ key: 'compose:a1' })
  await clock.advance(500)
  // the message panel closes the choice panel in turn
  expect(await ui.find({ text: /Choose language/ })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('half a thought')
  await ui.unmount()
})

test('the options reach the pane: no log rows, other limit thresholds', { options: { logRows: 0, limitWarnAt: 10, limitAlertAt: 20 } }, async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /spawned · Haiku/ })).toBeUndefined()
  // the session limit, 23%, is past red at 20%
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"color":"error"')
  await ui.unmount()
})

test('with the default thresholds the same 23% session limit is green: nothing red in the pane', async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('"color":"error"')
  await ui.unmount()
})

/** The band above the prompt, as the engine asks this plugin for its row. */
function band(cols: number) {
  return {
    plugin: 'forge-agent-tree',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: cols, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const
}

test('with the pane closed, a line above the prompt sums up the agents', async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(500)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /Opus 5\.5 {2}1 running/ })).toBeDefined()
  await ui.unmount()
})

test('with the pane shown, the line gives the band back', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', panes: [{ id: 'forge-tree', title: 'Agent Tree // Forge', isShown: true, isFocused: false, isPlaced: true }] }
  const { clock } = await session($, on, [], world)
  await clock.advance(500)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /1 running/ })).toBeUndefined()
  await ui.unmount()
})

test('the option turns the line off', { options: { bandLine: false } }, async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(500)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /1 running/ })).toBeUndefined()
  await ui.unmount()
})

test('by default an advisor call and a new agent make no sound; the power-up does', async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(['play sounds/boot.wav'])
})

test('with the advisor’s sound on, macOS plays the uplink, once for calls close together', { options: { sound: true, advisorSound: true, soundSpawn: false, soundBoot: false } }, async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' }
  const { clock, sounds } = await session($, on, [], world)
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(['play sounds/advisor.wav'])
  // a second call right after: one sound for both
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toHaveLength(1)
})

test('on Windows PowerShell plays the sound file from the plugin’s folder', { options: { sound: true, advisorSound: true, soundSpawn: false, soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Windows_NT', pluginRoot: 'C:\\plugins\\forge' })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(["run powershell.exe -NoProfile -NonInteractive -Command (New-Object System.Media.SoundPlayer 'C:\\plugins\\forge\\sounds\\advisor.wav').PlaySync()"])
})

test('on Windows with no plugin folder to read, the event beeps its tune instead', { options: { sound: true, advisorSound: true, soundSpawn: false, soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Windows_NT' })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(['run powershell.exe -NoProfile -NonInteractive -Command [console]::beep(1319,70); [console]::beep(1976,90)'])
})

test('on Linux paplay plays the sound file', { options: { sound: true, advisorSound: true, soundSpawn: false, soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Linux', pluginRoot: '/opt/forge' })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(['run paplay /opt/forge/sounds/advisor.wav'])
})

test('the power-up sounds when the pane opens at the start; with its switch on, the deployed agent too', { options: { soundSpawn: true } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' })
  await clock.advance(1000)
  expect(sounds).toEqual(['play sounds/boot.wav', 'play sounds/spawn.wav'])
})

test('an options change reloads the plugin with the pane already open: the power-up does not sound again', { options: { sound: true, soundSpawn: false } }, async ($, on) => {
  const shown = [{ id: 'forge-tree', title: 'Agent Tree // Forge', isShown: true, isFocused: false, isPlaced: true }]
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin', panes: shown })
  await clock.advance(1000)
  expect(sounds).toEqual([])
})

test('the HUD is the pane’s look by default: its boot sequence at the first opening, then its title bar and its rails', { options: { hud: true } }, async ($, on) => {
  const { clock } = await session($, on)
  // the boot sequence runs at the first opening: the title types itself in, the systems report
  const booting = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await booting.find({ text: /^◢◤ AGENT TREE/ })).toBeDefined()
  expect(await booting.find({ text: /^┌ CORE ┄+┐$/ })).toBeUndefined()
  await booting.unmount()
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^◢◤ AGENT TREE \/\/ FORGE ━+ ◉ NOMINAL ▾en$/ })).toBeDefined()
  expect(await ui.find({ text: /^┌ CORE ┄+┐$/ })).toBeDefined()
  expect(await ui.find({ text: /^⬢ main/ })).toBeDefined()
  await ui.unmount()
})

test('in the HUD a panel unfolds as it opens, then stands whole', { options: { hud: true } }, async ($, on) => {
  const { clock } = await session($, on)
  // past the boot sequence of the first opening
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:model' })
  expect(await ui.find({ text: /^┏━━ SESSION MODEL/ })).toBeDefined()
  expect(await ui.find({ key: 'choose:model:opusplan' })).toBeUndefined()
  await clock.advance(1000)
  expect(await ui.find({ key: 'choose:model:opusplan' })).toBeDefined()
  await ui.unmount()
})

test('with Sound off nothing sounds, but the sounds page plays each one to hear it', { options: { sound: false } }, async ($, on) => {
  const { clock, sounds, configSets } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual([])
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-options' })
  // the options page: the switch for them all, and the row to the sounds page with how many are on
  expect(await ui.find({ text: /^Sound +off$/ })).toBeDefined()
  expect(await ui.find({ text: /^Sound events +6\/8 ▸$/ })).toBeDefined()
  await ui.press({ key: 'sounds' })
  expect(await ui.find({ text: /^Sounds$/ })).toBeDefined()
  expect(await ui.find({ text: /^Turn complete +► +on$/ })).toBeDefined()
  await ui.press({ key: 'test:turn' })
  await clock.advance(10)
  expect(sounds).toEqual(['play sounds/turn.wav'])
  await ui.press({ key: 'option:soundTurn' })
  expect(configSets).toEqual([{ key: 'forge-agent-tree.soundTurn', value: false }])
  // o goes back to the options page, and from there to the tree
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /^Options$/ })).toBeDefined()
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /Find auth handlers/ })).toBeDefined()
  await ui.unmount()
})

/** A workflow agent's spawn, as a run's `agent()` raises it (checked live, plan 05). */
async function member($: Engine, label: string, index: number): Promise<void> {
  await $.agent.spawn({
    tool_use_id: 'tu_wf',
    prompt: `do ${label}`,
    description: label,
    subagentType: 'workflow-subagent',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    model: 'haiku',
    background: false,
    fork: false,
    workflow: { runId: 'wf_r', agentIndex: index },
  })
}

test('a workflow run: the tool names it, its agents go under its row, a press opens it, its notification ends it', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', workflow: { runId: 'wf_r', taskId: 'tk1', workflowName: 'review-changes', summary: 'Review the diff' } }
  const { clock, spawns } = await session($, on, [], world)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'review-changes', description: 'Review the diff' }", tool_use_id: 'tu_wf' })
  await clock.advance(10)
  await member($, 'verify:auth.ts', 1)
  await member($, 'verify:db.ts', 2)
  // the agents' model is the script's: nothing chosen for new subagents touches it
  expect(spawns.slice(1)).toEqual([
    { model: 'haiku', fork: false },
    { model: 'haiku', fork: false },
  ])
  // the second one (a3) finishes: it folds into the run's counts
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a3', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ key: 'run:wf_r' })).toBeDefined()
  expect(await ui.find({ text: /▣ review-changes  \d\d:\d\d +× 2  1✓ 1. / })).toBeDefined()
  expect(await ui.find({ text: /Review the diff/ })).toBeDefined()
  expect(await ui.find({ text: /verify:auth\.ts/ })).toBeDefined()
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeUndefined()
  // the log names the run's start, not its agents
  expect(await ui.find({ text: /▣ review-changes +started/ })).toBeDefined()
  expect(await ui.find({ text: /● verify:auth\.ts +spawned/ })).toBeUndefined()
  // a run's agent opens nothing
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  // pressed, the run shows all of its agents; pressed again, folds them
  await ui.press({ key: 'run:wf_r' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeDefined()
  await ui.press({ key: 'run:wf_r' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeUndefined()
  // with `f` on (every finished agent shown), the run's row still folds it and opens it again (the user's report)
  await ui.press({ key: 'key-finished' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeDefined()
  await ui.press({ key: 'run:wf_r' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeUndefined()
  await ui.press({ key: 'run:wf_r' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeDefined()
  // `f` again: every run folds back, what the rows were pressed to gone
  await ui.press({ key: 'key-finished' })
  expect(await ui.find({ text: /verify:db\.ts/ })).toBeUndefined()
  // its notification, as the main conversation takes it in: ended, how long it took (its own measure, never past now)
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>tk1</task-id>\n<tool-use-id>tu_wf</tool-use-id>\n<status>completed</status>\n<usage><agent_count>2</agent_count><duration_ms>800</duration_ms></usage>\n</task-notification>',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  await clock.advance(1000)
  expect(await ui.find({ text: /review-changes +done · × 2 +0s/ })).toBeDefined()
  // the agent still at work when it ended is stopped
  expect(await ui.find({ text: /▣ review-changes  \d\d:\d\d +× 2  1✓ 1■/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt typed while a turn runs shows in the main row at once; a command or a notification does not', async ($, on) => {
  const { clock } = await session($, on)
  // typed while a turn runs (its turnId): no new turn starts (checked live), the row shows it all the same
  await $.prompt.submit({ text: 'review the hooks folder', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /main +“review the hooks folder”/ })).toBeDefined()
  await $.prompt.submit({ text: '/model haiku', wait: false, origin: { kind: 'composer' }, command: { name: 'model', args: 'haiku' } as never })
  await $.prompt.submit({ text: '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>', wait: false, origin: { kind: 'task-notification' } })
  await clock.advance(1000)
  expect(await ui.find({ text: /main +“review the hooks folder”/ })).toBeDefined()
  await ui.unmount()
})

test('o opens the options page; a press sets the option as /config would; a locked one has no button; o goes back', async ($, on) => {
  const { configSets } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', lockedOptions: ['bandLine'] })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /^Options$/ })).toBeDefined()
  expect(await ui.find({ text: /^Sound +on$/ })).toBeDefined()
  await ui.press({ key: 'option:sound' })
  await ui.press({ key: 'option:logRows:up' })
  await ui.press({ key: 'option:columns:down' })
  expect(configSets).toEqual([
    { key: 'forge-agent-tree.sound', value: false },
    { key: 'forge-agent-tree.logRows', value: 6 },
    { key: 'forge-agent-tree.columns', value: 52 },
  ])
  // the line above the prompt is locked by a policy: its value shows, no button
  expect(await ui.find({ key: 'option:bandLine' })).toBeUndefined()
  expect(await ui.find({ key: 'option:animate' })).toBeDefined()
  // the language by its own name opens the language panel here
  await ui.press({ key: 'picker:lang' })
  expect(await ui.find({ text: /Choose language/ })).toBeDefined()
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /^Options$/ })).toBeUndefined()
  expect(await ui.find({ text: /Find auth handlers/ })).toBeDefined()
  await ui.unmount()
})

test('a narrow pane draws its keys row with the keys alone, and they still press', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ ...pane(36), surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toMatch(/"key":"key-options","label":"","hotkey":"o"|"hotkey":"o"[^}]*"label":""|"label":""[^}]*"hotkey":"o"/)
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /^Options$/ })).toBeDefined()
  await ui.unmount()
})

test('f is kept for every session, as l is: a press stores it, a new session starts with it', async ($, on) => {
  const { stored } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-finished' })
  expect(stored.get('ui')).toEqual({ showLog: true, showFinished: true })
  await ui.press({ key: 'key-log' })
  expect(stored.get('ui')).toEqual({ showLog: false, showFinished: true })
  await ui.unmount()
})

test('a session starts with the finished agents shown when f was left on', async ($, on) => {
  const a1: AgentInfo = {
    id: 'a9',
    description: 'Old explorer',
    type: 'Explore',
    status: 'completed',
    startTime: T0 - 60_000,
  } as AgentInfo
  const b1: AgentInfo = { ...a1, id: 'a8', description: 'Older explorer', startTime: T0 - 120_000 } as AgentInfo
  await session($, on, [a1, b1], { id: 's1', model: 'claude-opus-5-5', store: { language: 'en', ui: { showLog: true, showFinished: true } } })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  // both finished agents show, none folded into "+ n finished"
  expect(await ui.find({ text: /Old explorer/ })).toBeDefined()
  expect(await ui.find({ text: /Older explorer/ })).toBeDefined()
  expect(await ui.find({ text: /\+ \d+ finished/ })).toBeUndefined()
  await ui.unmount()
})

// ── the mod's own update (plan 07) ──────────────────────────────────────

const MANIFEST = 'https://raw.githubusercontent.com/JZO001/forge-agent-tree/main/.claude-plugin/plugin.json'
const UPDATE = 'claude plugin update forge-agent-tree@forge-agent-tree --scope user'

test('an installed copy finds a newer version on GitHub at the start and updates itself', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', update: { installed: '0.1.0', latest: '0.1.1' } }
  const { updates, fetched, toasts, stored } = await session($, on, [], world)
  await until(() => toasts.some(t => t.includes('0.1.1')))
  expect(updates).toEqual(['claude plugin list --json', UPDATE, 'claude plugin list --json'])
  expect(fetched).toEqual([MANIFEST])
  expect(toasts).toContain('Agent Tree // Forge: updated to 0.1.1; /reload-plugins or a restart loads it')
  expect(stored.get('update')).toEqual({ checkedAt: T0 })
})

test('an update that fails says so with the command to run, and keeps that version from being tried again', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', update: { installed: '0.1.0', latest: '0.1.1', exit: 1 } }
  const { toasts, stored } = await session($, on, [], world)
  await until(() => toasts.some(t => t.includes('0.1.1')))
  expect(toasts).toContain(`Agent Tree // Forge: could not update to 0.1.1; by hand: ${UPDATE}`)
  expect(stored.get('update')).toEqual({ checkedAt: T0, failed: '0.1.1' })
})

test('the toasts speak the pane language', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', store: { language: 'hu' }, update: { installed: '0.1.0', latest: '0.1.1' } }
  const { toasts } = await session($, on, [], world)
  await until(() => toasts.some(t => t.includes('0.1.1')))
  expect(toasts).toContain('Agent Tree // Forge: frissítve erre: 0.1.1; a /reload-plugins vagy egy újraindítás tölti be')
})

test('with the Auto-update option off, nothing is run or fetched', { options: { autoUpdate: false } }, async ($, on) => {
  const { updates, fetched } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', update: { installed: '0.1.0', latest: '0.1.1' } })
  await until(() => false, 150)
  expect(updates).toEqual([])
  expect(fetched).toEqual([])
})

test('a switch that turns updates off keeps the check from running', async ($, on) => {
  const { updates, fetched } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', env: { DISABLE_AUTOUPDATER: '1' }, update: { installed: '0.1.0', latest: '0.1.1' } })
  await until(() => false, 150)
  expect(updates).toEqual([])
  expect(fetched).toEqual([])
})

test('a check within the day runs nothing', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', store: { language: 'en', update: { checkedAt: T0 - 3_600_000 } }, update: { installed: '0.1.0', latest: '0.1.1' } }
  const { updates, fetched } = await session($, on, [], world)
  await until(() => false, 150)
  expect(updates).toEqual([])
  expect(fetched).toEqual([])
})

test('a copy run from its folder (--plugin-dir) asks GitHub nothing', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', update: { id: 'forge-agent-tree@inline', installed: '0.1.0', latest: '0.1.1' } }
  const { updates, fetched, stored } = await session($, on, [], world)
  await until(() => updates.length > 0)
  await until(() => false, 100)
  expect(updates).toEqual(['claude plugin list --json'])
  expect(fetched).toEqual([])
  expect(stored.get('update')).toEqual({ checkedAt: T0 })
})

test('the options page switches Auto-update off as /config would', async ($, on) => {
  const { configSets } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-options' })
  expect(await ui.find({ text: /^Auto-update +on$/ })).toBeDefined()
  await ui.press({ key: 'option:autoUpdate' })
  expect(configSets).toEqual([{ key: 'forge-agent-tree.autoUpdate', value: false }])
  await ui.unmount()
})

// ── found in the review of 2026-11-20 ───────────────────────────────────

test('a `claude -p` run: no pane, no sound, no update check', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', interactive: false, sysname: 'Darwin', update: { installed: '0.1.0', latest: '0.1.1' } }
  const { clock, sounds, opens, updates, fetched } = await session($, on, [], world)
  // an agent fails, a turn ends: an interactive session would sound them
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'error' })
  await clock.advance(1000)
  await until(() => false, 150)
  expect(opens).toEqual([])
  expect(sounds).toEqual([])
  expect(updates).toEqual([])
  expect(fetched).toEqual([])
})

test('a subagent that fails at once still sounds its failure', { options: { soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' })
  // spawned and failed within one tick
  await spawn($)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'y', agentId: 'a2', reason: 'error' })
  await clock.advance(500)
  expect(sounds).toEqual(['play sounds/failed.wav'])
})

test('two at once: the more important sounds first, the other after it', { options: { soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' })
  await $.turn.start({ text: 'go', turnId: 'm1' })
  await clock.advance(500)
  // the main turn ends as the explorer fails
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'error' })
  await $.turn.complete({ answer: 'ok', durationMs: 900, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.advance(1500)
  expect(sounds).toEqual(['play sounds/failed.wav', 'play sounds/turn.wav'])
})

test('a typed /advisor Claude Code refuses leaves the advisor as it stands', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', settings: { advisorModel: 'fable' }, noAdvisor: ['sonnet'] }
  const { clock } = await session($, on, [], world)
  await $.command.run({ command: 'advisor', args: 'sonnet', ...typed })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /◆ ▾Fable advisor/ })).toBeDefined()
  expect(await ui.find({ text: /◆ ▾sonnet/i })).toBeUndefined()
  await ui.unmount()
})

test('a reload (a change of options) with the pane closed leaves it closed; with it shown, opens it again, booting nothing', { options: { hud: true } }, async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' }
  const { clock, opens, sounds } = await session($, on, [], world)
  expect(opens).toHaveLength(1)
  await clock.advance(3000)
  // the person closed it; the options change and the plugin's start runs again
  world.panes = []
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(500)
  expect(opens).toHaveLength(1)
  // shown again (`/tree`): a reload reopens it, so a new width applies, with no boot and no power-up
  world.panes = [{ id: 'forge-tree', title: 'Agent Tree // Forge', isShown: true, isFocused: false, isPlaced: true }]
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(opens).toHaveLength(2)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^┌ CORE ┄+┐$/ })).toBeDefined()
  await ui.unmount()
  expect(sounds).toEqual(['play sounds/boot.wav'])
})

test('/tree close closes the pane and /tree opens it again, booting nothing the second time', { options: { hud: true } }, async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' }
  const { clock, opens, closes, sounds } = await session($, on, [], world)
  await clock.advance(3000)
  const closed = await $.command.run({ command: 'tree', args: 'close', ...typed })
  expect(closes).toHaveLength(1)
  expect(JSON.stringify(closes[0])).toContain('forge-tree')
  expect(closed.text).toBe('Agent Tree // Forge closed.')
  world.panes = []
  const opened = await $.command.run({ command: 'tree', args: '', ...typed })
  expect(opened.text).toBe('Agent Tree // Forge opened.')
  expect(opens).toHaveLength(2)
  await clock.advance(100)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^┌ CORE ┄+┐$/ })).toBeDefined()
  await ui.unmount()
  expect(sounds).toEqual(['play sounds/boot.wav'])
})

test('a session swap is silent: what the new session already holds sounds nothing', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin' }
  const { clock, sounds } = await session($, on, [], world)
  await clock.advance(500)
  // the session in place after a /resume stands at its red mark already
  world.id = 's2'
  world.percent = 92
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(4000)
  expect(sounds).toEqual(['play sounds/boot.wav'])
})

test('with Motion off nothing moves: an agent at work shows a still sign', { options: { animate: false } }, async ($, on) => {
  const { clock } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /[├└]─ ● Find auth handlers/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(100)
})

test('reduced motion set while the session runs stops the motion within seconds', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5' }
  const { clock } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /[├└]─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Find auth handlers/ })).toBeDefined()
  world.settings = { prefersReducedMotion: true }
  await clock.advance(11_000)
  expect(await ui.find({ text: /[├└]─ ● Find auth handlers/ })).toBeDefined()
  await ui.unmount()
})

for (const name of ['DO_NOT_TRACK', 'DISABLE_AUTOUPDATER', 'DISABLE_UPDATES', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']) {
  test(`${name} keeps the update check from running`, async ($, on) => {
    const { updates, fetched } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', env: { [name]: '1' }, update: { installed: '0.1.0', latest: '0.1.1' } })
    await until(() => false, 150)
    expect(updates).toEqual([])
    expect(fetched).toEqual([])
  })
}

test('an option is set under the key /config lists for it; a refusal says why', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', optionPrefix: 'forge-agent-tree@mkt.', listedOptions: ['sound', 'advisorSound'], configRefuse: 'managed by a policy' }
  const { clock, configSets, toasts } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-options' })
  await ui.press({ key: 'option:sound' })
  await clock.advance(100)
  expect(configSets).toEqual([{ key: 'forge-agent-tree@mkt.sound', value: false }])
  expect(toasts.some(t => t.includes('managed by a policy'))).toBe(true)
  await ui.unmount()
})

test('on Windows, a sound file that will not play beeps its tune instead', { options: { advisorSound: true, soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Windows_NT', pluginRoot: 'C:\\plugins\\forge', playerExit: 1 })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual([
    "run powershell.exe -NoProfile -NonInteractive -Command (New-Object System.Media.SoundPlayer 'C:\\plugins\\forge\\sounds\\advisor.wav').PlaySync()",
    'run powershell.exe -NoProfile -NonInteractive -Command [console]::beep(1319,70); [console]::beep(1976,90)',
  ])
})

test('on Linux, where paplay does not play it, aplay does', { options: { advisorSound: true, soundBoot: false } }, async ($, on) => {
  const { clock, sounds } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', sysname: 'Linux', pluginRoot: '/opt/forge', playerExit: 1 })
  await step($, undefined, 'high')
  await clock.advance(500)
  expect(sounds).toEqual(['run paplay /opt/forge/sounds/advisor.wav', 'run aplay -q /opt/forge/sounds/advisor.wav'])
})

test('a server tool that is not the advisor is no advisor call', { options: { advisorSound: true, soundBoot: false } }, async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Darwin', serverTools: [{ id: 'w1', name: 'web_search', input: {}, startedAt: T0 + 100, endedAt: T0 + 900 }] }
  const { clock, sounds } = await session($, on, [], world)
  await step($, undefined, 'high')
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /◆ × 1/ })).toBeUndefined()
  expect(await ui.find({ text: /called by/ })).toBeUndefined()
  expect(sounds).toEqual([])
  await ui.unmount()
})

test('a reply’s figures reach the header: the context, the limits, the cost; a compaction is logged', async ($, on) => {
  const { clock } = await session($, on)
  await $.session.measure({
    context: { window: 200_000, percent: 61, tokens: 122_000 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 70, resetsAt: new Date(T0 + 2 * 86_400_000).toISOString() }],
    cost: { usd: 1.2 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^ctx .* 61%/ })).toBeDefined()
  expect(await ui.find({ text: /^all .* 70%/ })).toBeDefined()
  expect(await ui.find({ text: /≈\$1\.20/ })).toBeDefined()
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'the summary so far', toolUses: [] }] })
  await clock.advance(500)
  expect(await ui.find({ text: /context compacted/ })).toBeDefined()
  await ui.unmount()
})

test('the line above the prompt yields to a survey and to an agent’s transcript', async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(500)
  const survey = await $.ui.mount({ ...band(100), props: { ...band(100).props, hasSurvey: true }, surface: 'terminal' })
  expect(await survey.find({ text: /1 running/ })).toBeUndefined()
  await survey.unmount()
  const transcript = await $.ui.mount({ ...band(100), props: { ...band(100).props, view: { agentId: 'a1' } }, surface: 'terminal' })
  expect(await transcript.find({ text: /1 running/ })).toBeUndefined()
  await transcript.unmount()
})

test('a message delivered: its draft goes, and the field opens empty next time', async ($, on) => {
  const { clock } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'compose:a1' })
  await ui.input({ key: 'message:a1', text: 'look in lib/ too', kind: 'change' })
  await ui.input({ key: 'message:a1', text: 'look in lib/ too' })
  await clock.advance(500)
  await ui.press({ key: 'compose:a1' })
  await clock.advance(500)
  expect(await ui.find({ text: /✎ Message to/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('look in lib/ too')
  await ui.unmount()
})

test('a session starts with the log hidden when l was left off', async ($, on) => {
  await session($, on, [], { id: 's1', model: 'claude-opus-5-5', store: { language: 'en', ui: { showLog: false, showFinished: false } } })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /spawned · Haiku/ })).toBeUndefined()
  await ui.unmount()
})

test('with l left on, the log shows', async ($, on) => {
  await session($, on, [], { id: 's1', model: 'claude-opus-5-5', store: { language: 'en', ui: { showLog: true, showFinished: false } } })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /spawned · Haiku/ })).toBeDefined()
  await ui.unmount()
})

test('an agent’s own agent hangs under it', async ($, on) => {
  const { clock } = await session($, on)
  await $.agent.spawn({
    tool_use_id: 'tu7',
    prompt: 'check the routes',
    description: 'Check routes',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-haiku-5-5',
    background: false,
    fork: false,
    parentAgentId: 'a1',
  })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^└─ \S+ Find auth handlers/ })).toBeDefined()
  expect(await ui.find({ text: /^ {3}└─ \S+ Check routes/ })).toBeDefined()
  await ui.unmount()
})

kitTest('the HUD is the look when no option says otherwise (the manifest’s default)', async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /^◢◤ AGENT TREE \/\/ FORGE/ })).toBeDefined()
  await ui.unmount()
})

test('the limit marks step by five: yellow up to 65, red down to 85', async ($, on) => {
  const { clock, configSets } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'key-options' })
  await ui.press({ key: 'option:limitWarnAt:up' })
  await ui.press({ key: 'option:limitAlertAt:down' })
  await clock.advance(100)
  expect(configSets).toEqual([
    { key: 'forge-agent-tree.limitWarnAt', value: 65 },
    { key: 'forge-agent-tree.limitAlertAt', value: 85 },
  ])
  await ui.unmount()
})

test('a workflow run launched elsewhere (remote_launched) has no row here', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', workflow: { runId: 'wf_remote', taskId: 'tk9', workflowName: 'far-away', summary: 'Runs in the cloud' }, workflowStatus: 'remote_launched' }
  const { clock } = await session($, on, [], world)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'far-away' }", tool_use_id: 'tu_far' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ key: 'run:wf_remote' })).toBeUndefined()
  expect(await ui.find({ text: /far-away/ })).toBeUndefined()
  await ui.unmount()
})

test('with Motion off the HUD’s log clock still turns its minute', { options: { animate: false, hud: true } }, async ($, on) => {
  const { clock } = await session($, on, [], { id: 's1', model: 'claude-opus-5-5', noLimits: true })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  const before = (await ui.find({ text: /^┌ LOG ┄+ \d\d:\d\d ┐$/ }))?.text
  expect(before).toBeDefined()
  await clock.advance(2 * 60_000)
  const after = (await ui.find({ text: /^┌ LOG ┄+ \d\d:\d\d ┐$/ }))?.text
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  await ui.unmount()
})

test('a workflow’s agents keep the script’s model though one is chosen for new subagents; a plain agent gets it', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', workflow: { runId: 'wf_r', taskId: 'tk1', workflowName: 'review-changes', summary: 'Review the diff' } }
  const { clock, spawns } = await session($, on, [], world)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:agentModel' })
  await ui.press({ key: 'choose:agentModel:sonnet' })
  await clock.advance(100)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'review-changes' }", tool_use_id: 'tu_wf' })
  await member($, 'verify:auth.ts', 1)
  await spawn($)
  // (the test this guards passed with nothing chosen, so it could not tell: review of 2026-11-20)
  expect(spawns.slice(1)).toEqual([
    { model: 'haiku', fork: false },
    { model: 'sonnet', fork: false },
  ])
  await ui.unmount()
})

test('a message with auto gives a new agent its own level back, over the effort chosen for new subagents', async ($, on) => {
  const { clock, steps } = await session($, on)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  await ui.press({ key: 'picker:agentEffort' })
  await ui.press({ key: 'choose:agentEffort:low' })
  await clock.advance(100)
  // a new agent: its requests carry the chosen level
  await spawn($)
  await step($, 'a2', 'high')
  expect(steps.at(-1)).toEqual({ agentId: 'a2', effort: 'low' })
  await clock.advance(500)
  // a message with auto: its own level from then on, the chosen one does not come back
  await ui.press({ key: 'compose:a2' })
  await ui.press({ key: 'choose:msgEffort:auto' })
  await ui.input({ key: 'message:a2', text: 'as you were' })
  await step($, 'a2', 'high')
  await step($, 'a2', 'high')
  expect(steps.slice(-2)).toEqual([
    { agentId: 'a2', effort: 'high' },
    { agentId: 'a2', effort: 'high' },
  ])
  await ui.unmount()
})

test('an npm install on Windows: claude starts through cmd.exe, the update too (the user’s choice of 2026-11-20)', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Windows_NT', claudeViaCmd: true, update: { installed: '0.1.0', latest: '0.1.1' } }
  const { updates, toasts } = await session($, on, [], world)
  await until(() => toasts.some(t => t.includes('0.1.1')))
  const cmd = 'cmd.exe /d /c '
  expect(updates).toEqual(['claude plugin list --json', `${cmd}claude plugin list --json`, `${cmd}${UPDATE}`, `${cmd}claude plugin list --json`])
  expect(toasts).toContain('Agent Tree // Forge: updated to 0.1.1; /reload-plugins or a restart loads it')
})

test('elsewhere a claude that cannot start is no install: no cmd.exe, nothing more', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Linux', claudeViaCmd: true, update: { installed: '0.1.0', latest: '0.1.1' } }
  const { updates, fetched, toasts } = await session($, on, [], world)
  await until(() => updates.length > 0)
  await until(() => false, 100)
  expect(updates).toEqual(['claude plugin list --json'])
  expect(fetched).toEqual([])
  expect(toasts.some(t => t.includes('0.1.1'))).toBe(false)
})

test('through cmd.exe a marketplace name cmd.exe would read as a command is never run', async ($, on) => {
  const world: World = { id: 's1', model: 'claude-opus-5-5', sysname: 'Windows_NT', claudeViaCmd: true, update: { id: 'forge-agent-tree@evil&calc', installed: '0.1.0', latest: '0.1.1' } }
  const { updates, toasts } = await session($, on, [], world)
  await until(() => toasts.some(t => t.includes('0.1.1')))
  // listed through cmd.exe, but the update itself not run
  expect(updates.some(u => u.includes(' update '))).toBe(false)
  expect(toasts.some(t => t.includes('could not update to 0.1.1'))).toBe(true)
})

test('with Motion off the countdown still moves, once a minute', { options: { animate: false } }, async ($, on) => {
  const { clock } = await session($, on)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  const before = (await ui.find({ text: /^session .* 23% .*in \dh\d\dm$/ }))?.text
  expect(before).toBeDefined()
  await clock.advance(3 * 60_000)
  const after = (await ui.find({ text: /^session .* 23% .*in \dh\d\dm$/ }))?.text
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  await ui.unmount()
})
