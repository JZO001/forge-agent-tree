import { describe, expect, test } from 'claude-code/testing'

import { activity, ago, at, duration, effortLevel, effortShort, modelEffort, modelName, seconds, tokenDelta, tokensFine, until, weatherFor, width, windowSize } from '../hooks/format'
import { chooseLang, langOf, wordsFor } from '../hooks/words'
import {
  MAX_AGENTS,
  configured,
  emptyTree,
  estimatedContext,
  listed,
  mainChanged,
  measured,
  messagePin,
  messaged,
  orphaned,
  pinBack,
  pendingSettled,
  recordOf,
  spawnModel,
  staleRecords,
  stepEffort,
  stepModel,
  rememberedLimits,
  spawned,
  stepped,
  toolCalled,
  trimmed,
  turnMeasured,
  turnCompleted,
  turnStarted,
  RUN_SETTLE_MS,
  STRAY_MS,
  adoptStrays,
  isMember,
  runEnded,
  runLaunched,
  runNoticed,
  runTally,
  settleRuns,
  taskNotices,
  prompted,
} from '../hooks/model'
import { advisorFromUsage, advisorSet } from '../hooks/model'
import type { ListedAgent } from '../hooks/model'
import type { TreeState } from '../types'

const T = 1_000_000

function withAgent(): TreeState {
  return spawned(
    emptyTree(T),
    { agentId: 'a1', description: 'Find auth handlers', type: 'Explore', model: 'claude-haiku-5-5' },
    T,
  )
}

function row(fields: Partial<ListedAgent> & { id: string }): ListedAgent {
  return { description: fields.id, type: 'Explore', status: 'running', ...fields }
}

describe('format', () => {
  test('the weather signs with a color emoji form keep a cell for it (Windows Terminal draws them two cells wide)', () => {
    for (const p of [0, 30, 60]) {
      const icon = weatherFor(p).icon
      expect(icon.endsWith(' '), icon).toBe(true)
      expect(width(icon)).toBe(2)
    }
    // the two with no emoji form stay one cell
    expect([weatherFor(80).icon, weatherFor(95).icon]).toEqual(['☇', '↯'])
  })

  test('reads model ids and aliases', () => {
    expect(modelName('claude-opus-5-5')?.long).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')?.short).toBe('H4.5')
    expect(modelName('claude-fable-5-2')?.family).toBe('fable')
    expect(modelName('claude-opus-4-20250514')?.long).toBe('Opus 4')
    expect(modelName('us.anthropic.claude-sonnet-5-5-v1:0')?.long).toBe('Sonnet 5.5')
    expect(modelName('sonnet')?.long).toBe('Sonnet')
    expect(modelName('gpt-x')?.family).toBe('other')
  })

  test('writes when a limit resets: how long until, and the local clock', () => {
    expect(until(45 * 60_000)).toBe('45m')
    expect(until((2 * 60 + 12) * 60_000)).toBe('2h12m')
    expect(until((2 * 24 + 4) * 3_600_000)).toBe('2d4h')
    expect(until(-5)).toBe('now')
    const now = new Date(2026, 10, 18, 14, 12).getTime()
    expect(at(new Date(2026, 10, 18, 16, 24).getTime(), now)).toBe('16:24')
    expect(at(new Date(2026, 10, 20, 18, 12).getTime(), now)).toBe('Fri 18:12')
    expect(at(new Date(2026, 10, 26, 9, 0).getTime(), now)).toBe('Nov 26 09:00')
  })

  test('writes tokens and windows as token-weather does', () => {
    expect(tokensFine(734)).toBe('734')
    expect(tokensFine(643_600)).toBe('643.6k')
    expect(tokensFine(1_250_000)).toBe('1.25M')
    expect(windowSize(1_000_000)).toBe('1M')
    expect(windowSize(200_000)).toBe('200k')
    expect(tokenDelta(23_700)).toBe('▲ +23.7k')
    expect(tokenDelta(-412_000)).toBe('▼ -412.0k')
  })

  test('writes durations and tool activity short', () => {
    expect(duration(38_000)).toBe('38s')
    expect(duration(72_000)).toBe('1m12s')
    expect(duration(12 * 60_000)).toBe('12m')
    expect(duration(64 * 60_000)).toBe('1h04m')
    expect(activity('Grep', { pattern: 'src/auth/**' })).toBe('Grep src/auth/**')
    expect(activity('Read', { file_path: 'C:\\src\\routes\\user.ts' })).toBe('Read routes/user.ts')
    expect(activity('Bash', { command: 'npm\n  test' })).toBe('Bash npm test')
    expect(activity('mcp__github__get_issue', {})).toBe('github·get_issue')
  })
})

describe('events', () => {
  test('a spawn adds a starting agent and a log entry', () => {
    const s = withAgent()
    expect(s.agents[0]).toMatchObject({ id: 'a1', description: 'Find auth handlers', state: 'starting', model: 'claude-haiku-5-5' })
    expect(s.log[0]).toMatchObject({ kind: 'spawn', text: 'spawned · Haiku 5.5' })
  })

  test('a tool call sets the activity and starts the agent', () => {
    const s = toolCalled(withAgent(), 'a1', 'Grep', { pattern: 'src/auth/**' }, T + 1000)
    expect(s.agents[0]).toMatchObject({ state: 'running', activity: 'Grep src/auth/**', tools: 1 })
    const main = toolCalled(s, undefined, 'Bash', { command: 'npm test' }, T + 2000)
    expect(main.main).toMatchObject({ activity: 'Bash npm test', tools: 1 })
  })

  test("a tool call of an agent the tree missed adds it, for the list to fill in", () => {
    const s = toolCalled(emptyTree(T), 'x9', 'Read', { file_path: '/a/b.ts' }, T)
    expect(s.agents[0]).toMatchObject({ id: 'x9', state: 'running', activity: 'Read a/b.ts' })
  })

  test('a turn end finishes, fails or stops an agent', () => {
    const ran = toolCalled(withAgent(), 'a1', 'Grep', { pattern: 'x' }, T)
    const done = turnCompleted(ran, { agentId: 'a1', reason: 'answer' }, T + 72_000)
    expect(done.agents[0]).toMatchObject({ state: 'done', endedAt: T + 72_000 })
    expect(done.log[0]).toMatchObject({ kind: 'done', text: 'done · 1 tool', right: '1m12s' })
    expect(turnCompleted(ran, { agentId: 'a1', reason: 'error' }, T).agents[0]?.state).toBe('failed')
    expect(turnCompleted(ran, { agentId: 'a1', reason: 'aborted' }, T).agents[0]?.state).toBe('stopped')
  })

  test('the main turn marks the session busy, then idle, with its prompt', () => {
    const busy = turnStarted(emptyTree(T), undefined, '\n  Move the API to Rust\nsecond line', T)
    expect(busy.main).toMatchObject({ isBusy: true, prompt: 'Move the API to Rust' })
    expect(turnCompleted(busy, { reason: 'answer' }, T + 5).main.isBusy).toBe(false)
  })

  test('advisor calls are counted, timed and logged', () => {
    const s = stepped(withAgent(), { model: 'claude-opus-5-5', advisor: [{ startedAt: T, endedAt: T + 4100 }] }, T)
    expect(s.advisor.total).toBe(1)
    expect(s.advisor.calls[0]).toMatchObject({ at: T, ms: 4100 })
    expect(s.log[0]).toMatchObject({ kind: 'advisor', text: 'called by main', right: '4.1s' })
    const byAgent = stepped(s, { agentId: 'a1', advisor: [{ startedAt: T + 10 }] }, T)
    expect(byAgent.log[0]?.text).toBe('called by Find auth handlers')
  })

  test('a model change mid-run is logged; an alias is no change', () => {
    const s = stepped(emptyTree(T), { model: 'opus', advisor: [] }, T)
    const same = stepped(s, { model: 'claude-opus-5-5', advisor: [] }, T)
    expect(same.log.length).toBe(0)
    const fell = stepped(same, { model: 'claude-sonnet-5-5', advisor: [] }, T)
    expect(fell.log[0]).toMatchObject({ kind: 'model', text: 'Opus 5.5 → Sonnet 5.5' })
  })

  test('context thresholds (storm 75%, red 90%) are logged once each, again after a compaction', () => {
    let s = measured(emptyTree(T), { percent: 72 }, T)
    expect(s.log.length).toBe(0)
    s = measured(s, { percent: 76 }, T)
    s = measured(s, { percent: 80 }, T)
    expect(s.log.map(e => e.text)).toEqual(['context 76%'])
    expect(s.log[0]?.percent).toBe(76)
    s = measured(s, { percent: 91, costUsd: 2.5 }, T)
    expect(s.log[0]?.text).toBe('context 91%')
    expect(s.main.costUsd).toBe(2.5)
    s = measured(s, { percent: 30 }, T)
    s = measured(s, { percent: 77 }, T)
    expect(s.log[0]?.text).toBe('context 77%')
  })
})

describe('effort', () => {
  test('reads the levels the engine names, and shortens them for a narrow pane', () => {
    expect(effortLevel(' XHigh ')).toBe('xhigh')
    expect(effortLevel('fast')).toBeUndefined()
    expect(effortLevel(undefined)).toBeUndefined()
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(e => effortShort(e))).toEqual(['lo', 'md', 'hi', 'xh', 'mx'])
  })

  test('reads the level /effort saved for a model, past a context suffix on its id', () => {
    const saved = { 'claude-sonnet-5-5': { effortLevel: 'high' }, 'claude-opus-5-5': { effortLevel: 'nonsense' } }
    expect(modelEffort(saved, 'claude-sonnet-5-5')).toBe('high')
    expect(modelEffort(saved, 'claude-sonnet-5-5[1m]')).toBe('high')
    expect(modelEffort(saved, 'claude-opus-5-5')).toBeUndefined()
    expect(modelEffort(saved, 'claude-haiku-5-5')).toBeUndefined()
    expect(modelEffort(undefined, 'claude-sonnet-5-5')).toBeUndefined()
    expect(modelEffort(saved, undefined)).toBeUndefined()
  })

  test('the configured effort fills the header until a request says otherwise', () => {
    const s = configured(emptyTree(T), { model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(s.main.effort).toBe('xhigh')
    expect(stepped(s, { effort: 'high', advisor: [] }, T).main.effort).toBe('high')
    expect(configured({ ...s, main: { ...s.main, effort: 'low' } }, { effort: 'xhigh' }).main.effort).toBe('low')
  })

  test('/effort and /model change the header at once', () => {
    const s = mainChanged(configured(emptyTree(T), { model: 'claude-opus-5-5', effort: 'xhigh' }), { effort: 'max' })
    expect(s.main).toMatchObject({ model: 'claude-opus-5-5', effort: 'max' })
    expect(mainChanged(s, { model: 'claude-sonnet-5-5' }).main).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'max' })
  })
})

describe('the advisor', () => {
  test('counts calls by main and by agents, their lengths, and marks the agent that asked', () => {
    let s = stepped(withAgent(), { advisor: [{ startedAt: T, endedAt: T + 4000 }] }, T)
    s = stepped(s, { agentId: 'a1', advisor: [{ startedAt: T + 10, endedAt: T + 6010 }, { startedAt: T + 20 }] }, T)
    expect(s.advisor).toMatchObject({ total: 3, fromMain: 1, fromAgents: 2, timed: 2, totalMs: 10_000, maxMs: 6000 })
    expect(s.agents[0]?.advisorCalls).toBe(2)
  })

  test("learns the advisor's model from an agent's usage: another model, ranking at or above its own", () => {
    expect(advisorFromUsage('claude-haiku-5-5', ['claude-haiku-5-5', 'claude-fable-5-2'])).toBe('claude-fable-5-2')
    expect(advisorFromUsage('claude-opus-5-5', ['claude-opus-5-5', 'claude-haiku-5-5'])).toBeUndefined()
    expect(advisorFromUsage('claude-opus-5-5', ['claude-opus-5-5'])).toBeUndefined()
  })

  test('the setting turns the advisor on, off, or leaves a learnt model be', () => {
    const on = advisorSet(emptyTree(T), { model: 'fable' })
    expect(on.advisor).toMatchObject({ model: 'fable' })
    expect(on.advisor.off).toBeUndefined()
    const off = advisorSet(on, { off: true })
    expect(off.advisor).toMatchObject({ off: true })
    expect(off.advisor.model).toBeUndefined()
    expect(advisorSet(off, { model: 'opus' }).advisor).toMatchObject({ model: 'opus' })
    const learnt = { ...emptyTree(T), advisor: { total: 1, calls: [], model: 'claude-fable-5-2' } }
    expect(advisorSet(learnt, {})).toBe(learnt)
  })

  test('the list names the advisor once an agent that asked it shows the model', () => {
    const asked = stepped(withAgent(), { agentId: 'a1', advisor: [{ startedAt: T }] }, T)
    const named = listed(asked, [row({ id: 'a1', model: 'claude-haiku-5-5', models: ['claude-haiku-5-5', 'claude-fable-5-2'] })], T)
    expect(named.advisor.model).toBe('claude-fable-5-2')
    // an agent that never asked tells nothing about the advisor
    const silent = listed(withAgent(), [row({ id: 'a1', model: 'claude-haiku-5-5', models: ['claude-fable-5-2'] })], T)
    expect(silent.advisor.model).toBeUndefined()
  })
})

describe('remembered limits', () => {
  const later = (h: number) => new Date(T + h * 3_600_000).toISOString()

  test('the windows not yet reset show, marked, until a response reports the limits', () => {
    const saved = [
      { kind: 'five_hour', percent: 40, resetsAt: later(-1) },
      { kind: 'seven_day', percent: 55, resetsAt: later(30) },
    ]
    const s = rememberedLimits(emptyTree(T), saved, T)
    expect(s.main).toMatchObject({ limitsEstimated: true, limits: [{ kind: 'seven_day', percent: 55 }] })
    const real = measured(s, { limits: [{ kind: 'five_hour', percent: 2 }] }, T)
    expect(real.main.limitsEstimated).toBeUndefined()
    expect(real.main.limits).toEqual([{ kind: 'five_hour', percent: 2 }])
  })

  test('limits a response reported here are never replaced by remembered ones', () => {
    const here = measured(emptyTree(T), { limits: [{ kind: 'five_hour', percent: 9, resetsAt: later(2) }] }, T)
    expect(rememberedLimits(here, [{ kind: 'five_hour', percent: 50, resetsAt: later(3) }], T)).toBe(here)
  })
})

describe('the context over turns', () => {
  test('each main turn is set against the one before, as token-weather does', () => {
    const first = turnMeasured(emptyTree(T), { tokens: 620_000, window: 1_000_000, percent: 62 }, T)
    expect(first.main).toMatchObject({ contextTokens: 620_000, lastTurnTokens: 620_000 })
    expect(first.main.turnDelta).toBeUndefined()
    const second = turnMeasured(first, { tokens: 643_600, window: 1_000_000, percent: 64 }, T)
    expect(second.main).toMatchObject({ contextPercent: 64, turnDelta: 23_600, lastTurnTokens: 643_600 })
  })
})

describe('the context before a response', () => {
  test('an estimate is kept until a measurement replaces it, and is never logged', () => {
    const guessed = estimatedContext(emptyTree(T), { percent: 92, tokens: 184_000, window: 200_000 })
    expect(guessed.main).toMatchObject({ contextPercent: 92, contextTokens: 184_000, contextEstimated: true })
    expect(guessed.log.length).toBe(0)
    const costOnly = measured(guessed, { costUsd: 0.1 }, T)
    expect(costOnly.main).toMatchObject({ contextPercent: 92, contextEstimated: true, costUsd: 0.1 })
    const real = measured(costOnly, { percent: 12, tokens: 24_000, window: 200_000 }, T)
    expect(real.main.contextPercent).toBe(12)
    expect(real.main.contextEstimated).toBeUndefined()
  })
})

describe('the agent list', () => {
  test('adds agents the events missed and maps their status', () => {
    const s = listed(emptyTree(T), [row({ id: 'b1', status: 'waiting', model: 'claude-sonnet-5-5' }), row({ id: 'b2', status: 'completed' })], T)
    expect(s.agents.map(a => [a.id, a.state])).toEqual([
      ['b1', 'waiting'],
      ['b2', 'done'],
    ])
    expect(s.log.map(e => e.text)).toEqual(['found · Sonnet 5.5'])
  })

  test('fills in tokens and cost, and logs a move to waiting', () => {
    const s = listed(withAgent(), [row({ id: 'a1', status: 'waiting', tokenCount: 21_000, contextWindowSize: 116_000, costUsd: 0.04 })], T + 5)
    expect(s.agents[0]).toMatchObject({ state: 'waiting', tokens: 21_000, window: 116_000, costUsd: 0.04, listed: true })
    expect(s.log[0]).toMatchObject({ kind: 'waiting' })
  })

  test('never reopens an ended run and never drops an agent', () => {
    const done = turnCompleted(withAgent(), { agentId: 'a1', reason: 'answer' }, T + 10)
    const stale = listed(done, [row({ id: 'a1', status: 'running' })], T + 20)
    expect(stale.agents[0]?.state).toBe('done')
    const empty = listed(stale, [], T + 30)
    expect(empty.agents.length).toBe(1)
  })

  test('a turn end the list already saw adds its reason and is not logged twice', () => {
    const seen = listed(withAgent(), [row({ id: 'a1', status: 'completed' })], T + 10)
    const logged = seen.log.length
    const ended = turnCompleted(seen, { agentId: 'a1', reason: 'error' }, T + 20)
    expect(ended.log.length).toBe(logged)
    expect(ended.agents[0]).toMatchObject({ state: 'failed', endReason: 'error' })
  })

  test('after a session swap, what the list no longer shows is stopped', () => {
    const busy = turnStarted(toolCalled(withAgent(), 'a1', 'Grep', { pattern: 'x' }, T), undefined, 'go', T)
    const swapped = orphaned(busy, new Set<string>(), T + 50)
    expect(swapped.agents[0]).toMatchObject({ state: 'stopped', endedAt: T + 50 })
    expect(swapped.main.isBusy).toBe(false)
    expect(orphaned(busy, new Set(['a1']), T + 50).agents[0]?.state).toBe('running')
  })

  test('an agent that left the list while working has ended', () => {
    const seen = listed(withAgent(), [row({ id: 'a1', status: 'running' })], T)
    const gone = listed(seen, [], T + 1000)
    expect(gone.agents[0]).toMatchObject({ state: 'done', endedAt: T + 1000 })
  })

  test(`keeps at most ${MAX_AGENTS} agents, dropping the oldest finished`, () => {
    let s = emptyTree(T)
    for (let i = 0; i < MAX_AGENTS + 5; i++) {
      s = { ...s, agents: [...s.agents, { id: `n${i}`, description: `n${i}`, type: 'Explore', state: 'done', since: T, startedAt: T, endedAt: T + i, tools: 0 }] }
    }
    s = trimmed(s)
    expect(s.agents.length).toBe(MAX_AGENTS)
    expect(s.agents[0]?.id).toBe('n5')
  })
})

describe('the pane language', () => {
  test('a saved choice wins; else the language setting, the locale, LANG; else English', () => {
    expect(chooseLang({ saved: 'hu', setting: 'english', locale: 'en-US' })).toBe('hu')
    expect(chooseLang({ saved: 'eu', setting: 'Hungarian' })).toBe('hu')
    expect(chooseLang({ saved: 'de', setting: 'Hungarian' })).toBe('de')
    expect(chooseLang({ setting: 'magyar' })).toBe('hu')
    expect(chooseLang({ setting: 'basque', locale: 'hu-HU' })).toBe('hu')
    expect(chooseLang({ locale: 'en-US', env: 'hu_HU.UTF-8' })).toBe('en')
    expect(chooseLang({ locale: 'eu-ES', env: 'hu_HU.UTF-8' })).toBe('hu')
    expect(chooseLang({ locale: 'eu-ES' })).toBe('en')
    expect(chooseLang({})).toBe('en')
  })

  test('reads a language off a free text, and no other', () => {
    expect(['hu', 'HU', 'hu-HU', 'hu_HU.UTF-8', 'Hungarian', 'magyar nyelven'].map(langOf)).toEqual(['hu', 'hu', 'hu', 'hu', 'hu', 'hu'])
    expect(['en', 'en-GB', 'English', 'angol'].map(langOf)).toEqual(['en', 'en', 'en', 'en'])
    expect(['human', 'enough', 'eu-ES', '', undefined, 3].map(langOf)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })

  test('times in Hungarian: units, the decimal comma, ago, until, days and dates', () => {
    expect([38_000, 72_000, 720_000, 3_840_000].map(ms => duration(ms, 'hu'))).toEqual(['38mp', '1p12mp', '12p', '1ó04p'])
    expect(seconds(4100, 'hu')).toBe('4,1mp')
    expect(seconds(4100)).toBe('4.1s')
    expect([45 * 60_000, 132 * 60_000, 52 * 3_600_000].map(ms => until(ms, 'hu'))).toEqual(['45p', '2ó12p', '2n4ó'])
    expect(until(0, 'hu')).toBe('most')
    expect(ago(130_000, 'hu')).toBe('2p ezelőtt')
    expect(ago(130_000)).toBe('2m ago')
    expect(ago(12_000, 'hu')).toBe('12mp ezelőtt')
    const friday = new Date(2026, 10, 20, 18, 12).getTime()
    expect(at(friday, new Date(2026, 10, 18, 14, 0).getTime(), 'hu')).toBe('P 18:12')
    expect(at(new Date(2026, 10, 26, 9, 0).getTime(), new Date(2026, 10, 18, 14, 0).getTime(), 'hu')).toBe('nov. 26. 09:00')
  })

  test('log entries keep what they say as a phrase and their length raw, for the pane to write in its language', () => {
    expect(withAgent().log[0]).toMatchObject({ text: 'spawned · Haiku 5.5', say: { phrase: 'spawned', value: 'Haiku 5.5' } })
    const ran = toolCalled(withAgent(), 'a1', 'Grep', { pattern: 'x' }, T)
    expect(turnCompleted(ran, { agentId: 'a1', reason: 'answer' }, T + 72_000).log[0]).toMatchObject({ say: { phrase: 'done', value: 1 }, ms: 72_000 })
    expect(turnCompleted(ran, { agentId: 'a1', reason: 'refusal' }, T).log[0]).toMatchObject({ say: { phrase: 'refused' } })
    const asked = stepped(withAgent(), { agentId: 'a1', advisor: [{ startedAt: T, endedAt: T + 4100 }] }, T)
    expect(asked.log[0]).toMatchObject({ kind: 'advisor', say: { phrase: 'calledBy', value: 'Find auth handlers' }, ms: 4100 })
    expect(measured(emptyTree(T), { percent: 91 }, T).log[0]).toMatchObject({ say: { phrase: 'context', value: 91 } })
  })
})

describe('a pending session switch', () => {
  const asked = { pendingModel: 'sonnet', pendingEffort: 'high', pendingSince: T }
  const LIMIT = 600_000

  test('has taken effect once the menu, the model, the saved or the shown effort says so', () => {
    expect(pendingSettled(asked, { modelSetting: 'sonnet' }, T, LIMIT)).toMatchObject({ modelDone: true, effortDone: false })
    expect(pendingSettled(asked, { modelAlias: 'sonnet' }, T, LIMIT).modelDone).toBe(true)
    expect(pendingSettled(asked, { effortSaved: 'high' }, T, LIMIT).effortDone).toBe(true)
    expect(pendingSettled(asked, { effortShown: 'high' }, T, LIMIT).effortDone).toBe(true)
    expect(pendingSettled(asked, { modelSetting: 'opus', modelAlias: 'opus', effortSaved: 'xhigh' }, T, LIMIT)).toMatchObject({ modelDone: false, effortDone: false, givenUp: [] })
  })

  test('is given up once it has been pending longer than the limit', () => {
    expect(pendingSettled(asked, {}, T + LIMIT, LIMIT).givenUp).toEqual([])
    expect(pendingSettled(asked, {}, T + LIMIT + 1, LIMIT).givenUp).toEqual([
      { command: 'model', value: 'sonnet' },
      { command: 'effort', value: 'high' },
    ])
    expect(pendingSettled(asked, { modelSetting: 'sonnet' }, T + LIMIT + 1, LIMIT).givenUp).toEqual([{ command: 'effort', value: 'high' }])
    expect(pendingSettled(undefined, {}, T, LIMIT)).toEqual({ modelDone: false, effortDone: false, advisorDone: false, givenUp: [] })
  })
})

describe('new subagents', () => {
  test('a spawn is given the chosen model, except a fork, a resumed run, a workflow agent, or with the env forcing one', () => {
    const c = { agentModel: 'haiku' }
    expect(spawnModel(undefined, { fork: false })).toBeUndefined()
    expect(spawnModel({}, { fork: false })).toBeUndefined()
    expect(spawnModel(c, { fork: false })).toBe('haiku')
    expect(spawnModel(c, { fork: true })).toBeUndefined()
    expect(spawnModel(c, { fork: false, resume: { agentId: 'x' } })).toBeUndefined()
    expect(spawnModel(c, { fork: false, workflow: { runId: 'r' } })).toBeUndefined()
    expect(spawnModel({ ...c, agentModelForced: 'sonnet' }, { fork: false })).toBeUndefined()
  })

  test("a new agent's request carries the chosen effort and pins it; those at work, the main loop and requests with no level are left", () => {
    const c = { agentEffort: 'low', exempt: ['old'] }
    expect(stepEffort(c, 'new', 'high')).toEqual({ effort: 'low', pin: 'low' })
    expect(stepEffort(c, 'new', 'low')).toEqual({ pin: 'low' })
    expect(stepEffort(c, 'old', 'high')).toEqual({})
    expect(stepEffort(c, undefined, 'high')).toEqual({})
    expect(stepEffort(c, 'new', undefined)).toEqual({})
    expect(stepEffort(c, 'new', 3)).toEqual({})
    expect(stepEffort({ pins: { a: 'max' } }, 'a', 'high')).toEqual({ effort: 'max' })
    expect(stepEffort({ pins: { a: 'max' }, agentEffort: 'low' }, 'a', 'max')).toEqual({})
    expect(stepEffort(undefined, 'a', 'high')).toEqual({})
  })

  test('session records: read back only when whole; old and surplus ones go', () => {
    expect(recordOf({ agentModel: 'haiku', at: 5 })).toEqual({ agentModel: 'haiku', at: 5 })
    expect(recordOf({ agentModel: 3, agentEffort: 'low', at: 5 })).toEqual({ agentEffort: 'low', at: 5 })
    expect(recordOf({ agentModel: 'haiku' })).toBeUndefined()
    expect(recordOf('x')).toBeUndefined()
    const day = 86_400_000
    const records = [{ key: 'a', at: 100 * day }, { key: 'b', at: 99 * day }, { key: 'c', at: 60 * day }, { key: 'd', at: 98 * day }]
    expect(staleRecords(records, 100 * day, 30 * day, 10)).toEqual(['c'])
    expect(staleRecords(records, 100 * day, 30 * day, 2).sort()).toEqual(['c', 'd'])
  })

  test('an advisor switch has taken effect once the setting says so', () => {
    const off = { pendingAdvisor: 'off', pendingSince: T }
    expect(pendingSettled(off, { advisor: null }, T, 1000).advisorDone).toBe(true)
    expect(pendingSettled(off, { advisor: 'fable' }, T, 1000).advisorDone).toBe(false)
    expect(pendingSettled(off, {}, T, 1000).advisorDone).toBe(false)
    const opus = { pendingAdvisor: 'opus', pendingSince: T }
    expect(pendingSettled(opus, { advisor: 'opus' }, T, 1000).advisorDone).toBe(true)
    expect(pendingSettled(opus, { advisor: 'claude-opus-5-5' }, T, 1000).advisorDone).toBe(true)
    expect(pendingSettled(opus, { advisor: 'fable' }, T + 2000, 1000).givenUp).toEqual([{ command: 'advisor', value: 'opus' }])
  })
})

describe('a running subagent', () => {
  test('its requests go with the model it was switched to, unless they already name it', () => {
    const c = { runModels: { a1: 'sonnet', a2: 'opus[1m]' } }
    expect(stepModel(c, 'a1', 'claude-haiku-5-5')).toBe('sonnet')
    expect(stepModel(c, 'a1', 'claude-sonnet-5-5')).toBeUndefined()
    expect(stepModel(c, 'a2', 'claude-opus-5-5')).toBe('opus[1m]')
    expect(stepModel(c, 'a2', 'claude-opus-5-5[1m]')).toBeUndefined()
    expect(stepModel(c, 'a3', 'claude-haiku-5-5')).toBeUndefined()
    expect(stepModel(c, undefined, 'claude-haiku-5-5')).toBeUndefined()
    expect(stepModel(undefined, 'a1', 'claude-haiku-5-5')).toBeUndefined()
  })
})

describe('a message to a subagent', () => {
  test('a level becomes its pin, also over an exemption; auto removes the pin and exempts it; what stood before is kept', () => {
    const max = messagePin(undefined, 'a1', 'max')
    expect(max.patch).toEqual({ pins: { a1: 'max' }, exempt: [] })
    expect(max.before).toEqual({ exempt: false })
    expect(stepEffort(max.patch, 'a1', 'high')).toEqual({ effort: 'max' })
    const auto = messagePin({ pins: { a1: 'max', a2: 'low' } }, 'a1', 'auto')
    expect(auto.patch).toEqual({ pins: { a2: 'low' }, exempt: ['a1'] })
    expect(auto.before).toEqual({ pin: 'max', exempt: false })
    expect(stepEffort({ ...auto.patch, agentEffort: 'low' }, 'a1', 'high')).toEqual({})
    // exempt from the new-subagent effort, a level sent with a message still holds
    const again = messagePin({ exempt: ['a1'], agentEffort: 'low' }, 'a1', 'max')
    expect(stepEffort({ agentEffort: 'low', ...again.patch }, 'a1', 'high')).toEqual({ effort: 'max' })
  })

  test('not delivered: the effort goes back to where it stood', () => {
    const c = { pins: { a1: 'low' }, exempt: ['a2'] }
    const set = messagePin(c, 'a1', 'max')
    expect(pinBack(set.patch, 'a1', set.before)).toEqual({ pins: { a1: 'low' }, exempt: ['a2'] })
    const fresh = messagePin(undefined, 'a1', 'auto')
    expect(pinBack(fresh.patch, 'a1', fresh.before)).toEqual({ pins: {}, exempt: [] })
    const exempt = messagePin({ exempt: ['a1'] }, 'a1', 'max')
    expect(pinBack(exempt.patch, 'a1', exempt.before)).toEqual({ pins: {}, exempt: ['a1'] })
  })

  test('a message logs a row; a finished agent it resumes is running again at its turn\'s start, done at its end', () => {
    const logged = messaged(withAgent(), 'a1', T + 5)
    expect(logged.log[0]).toMatchObject({ kind: 'message', agentId: 'a1', say: { phrase: 'messaged' } })
    // the resume raises no agent.spawn (checked live): its turn's start is what brings it back
    const done = turnCompleted(withAgent(), { agentId: 'a1', reason: 'answer' }, T + 10)
    expect(done.agents[0]?.state).toBe('done')
    const back = turnStarted(done, 'a1', 'One more thing', T + 20)
    expect(back.agents[0]).toMatchObject({ state: 'running', endedAt: undefined })
    // the list, still saying running, leaves it so; its end is logged again
    expect(listed(back, [row({ id: 'a1', status: 'running' })], T + 21).agents[0]?.state).toBe('running')
    const again = turnCompleted(back, { agentId: 'a1', reason: 'answer' }, T + 30)
    expect(again.agents[0]?.state).toBe('done')
    expect(again.log.filter(e => e.kind === 'done')).toHaveLength(2)
  })
})

describe('reading the other languages', () => {
  test('from a code, a locale, LANG, or the name in English or in itself', () => {
    expect(['cs', 'cs-CZ', 'Czech', 'čeština'].map(langOf)).toEqual(['cs', 'cs', 'cs', 'cs'])
    expect(['de_DE.UTF-8', 'German', 'Deutsch'].map(langOf)).toEqual(['de', 'de', 'de'])
    expect(['es-ES', 'Spanish', 'español'].map(langOf)).toEqual(['es', 'es', 'es'])
    expect(['fr-FR', 'French', 'français'].map(langOf)).toEqual(['fr', 'fr', 'fr'])
    expect(['nl-NL', 'Dutch', 'Nederlands'].map(langOf)).toEqual(['nl', 'nl', 'nl'])
    expect(['pl-PL', 'Polish', 'polski'].map(langOf)).toEqual(['pl', 'pl', 'pl'])
    expect(['tr-TR', 'Turkish', 'Türkçe'].map(langOf)).toEqual(['tr', 'tr', 'tr'])
    expect(['ja-JP', 'Japanese', '日本語'].map(langOf)).toEqual(['ja', 'ja', 'ja'])
    expect(['ko-KR', 'Korean', '한국어'].map(langOf)).toEqual(['ko', 'ko', 'ko'])
    expect(['zh-CN', 'Chinese', '中文'].map(langOf)).toEqual(['zh', 'zh', 'zh'])
    expect(['eu-ES', 'Basque', 'esperanto', 'denglish'].map(langOf)).toEqual([undefined, undefined, undefined, undefined])
    expect(chooseLang({ setting: 'japanese', locale: 'en-US' })).toBe('ja')
    expect(chooseLang({ locale: 'de-AT' })).toBe('de')
  })

  test('their time units', () => {
    expect(duration(72_000, 'de')).toBe('1min12s')
    expect(duration(3_840_000, 'nl')).toBe('1u04min')
    expect(until(52 * 3_600_000, 'fr')).toBe('2j4h')
    expect(duration(3_840_000, 'ja')).toBe('1時間04分')
    expect(ago(130_000, 'zh')).toBe('2分前')
    expect(seconds(4100, 'tr')).toBe('4,1sn')
    expect(seconds(4100, 'ko')).toBe('4.1초')
  })
})

describe('the further European languages', () => {
  test('are read from a code, a locale or a name', () => {
    expect(['sk-SK', 'Slovak', 'slovenčina'].map(langOf)).toEqual(['sk', 'sk', 'sk'])
    expect(['sl-SI', 'Slovenian', 'slovenščina'].map(langOf)).toEqual(['sl', 'sl', 'sl'])
    expect(['sr-Latn-RS', 'Serbian', 'srpski', 'српски'].map(langOf)).toEqual(['sr', 'sr', 'sr', 'sr'])
    expect(['ro-RO', 'Romanian', 'română'].map(langOf)).toEqual(['ro', 'ro', 'ro'])
    expect(['it-IT', 'Italian', 'italiano'].map(langOf)).toEqual(['it', 'it', 'it'])
    expect(['nb-NO', 'nn-NO', 'no', 'Norwegian', 'norsk'].map(langOf)).toEqual(['no', 'no', 'no', 'no', 'no'])
    expect(['sv-SE', 'Swedish', 'svenska'].map(langOf)).toEqual(['sv', 'sv', 'sv'])
    expect(['fi-FI', 'Finnish', 'suomi'].map(langOf)).toEqual(['fi', 'fi', 'fi'])
    expect(['da-DK', 'Danish', 'dansk'].map(langOf)).toEqual(['da', 'da', 'da'])
    expect(['pt-PT', 'pt-BR', 'Portuguese', 'português'].map(langOf)).toEqual(['pt', 'pt', 'pt', 'pt'])
    expect(['el-GR', 'Greek', 'ελληνικά'].map(langOf)).toEqual(['el', 'el', 'el'])
    // Belgium speaks Dutch, French and German
    expect(['nl-BE', 'fr-BE', 'de-BE'].map(langOf)).toEqual(['nl', 'fr', 'de'])
  })

  test('count as their grammar does', () => {
    const sl = wordsFor('sl')
    expect([1, 2, 3, 5, 101, 102].map(n => sl.calls(n))).toEqual(['1 klic', '2 klica', '3 klici', '5 klicev', '101 klic', '102 klica'])
    const ro = wordsFor('ro')
    expect([1, 2, 19, 20, 101].map(n => ro.tools(n))).toEqual(['1 instrument', '2 instrumente', '19 instrumente', '20 de instrumente', '101 instrumente'])
    const sr = wordsFor('sr')
    expect([1, 2, 11, 21].map(n => sr.calls(n))).toEqual(['1 poziv', '2 poziva', '11 poziva', '21 poziv'])
    expect(wordsFor('sk').tools(3)).toBe('3 nástroje')
    expect(wordsFor('fi').calls(2)).toBe('2 kutsua')
  })

  test('their times', () => {
    expect(ago(130_000, 'sv')).toBe('för 2min sedan')
    expect(until(52 * 3_600_000, 'fi')).toBe('2pv4h')
    expect(duration(3_840_000, 'da')).toBe('1t04min')
    expect(ago(130_000, 'it')).toBe('2min fa')
    expect(until(52 * 3_600_000, 'ro')).toBe('2z4h')
    expect(ago(130_000, 'el')).toBe('πριν από 2min')
    expect(wordsFor('el').date(10, 26)).toBe('26 Νοε')
  })

  test('no Greek text uses the semicolon, the Greek question mark', () => {
    const el = wordsFor('el')
    const texts = [...Object.values(el.legend).flat(), el.agentModelNote, el.agentEffortNote, el.runModelNote, el.savedAsDefault, el.command.description, el.command.none, el.command.failed]
    for (const t of texts) expect(String(t).includes(';'), String(t)).toBe(false)
  })
})

describe('workflow runs', () => {
  const RUN = 'wf_e6268d87-f5f'
  const launched = (): TreeState =>
    runLaunched(emptyTree(T), { runId: RUN, name: 'probe-a', about: 'Probe run A', taskId: 'ww4as3j67', toolUseId: 'toolu_wf' }, T)
  const member = (s: TreeState, id: string, label: string, at: number): TreeState =>
    spawned(s, { agentId: id, description: label, type: 'workflow-subagent', model: 'claude-haiku-5-5', workflow: true, run: RUN, toolUseId: 'toolu_wf' }, at)

  test('the Workflow tool answers: the run starts, logged once by its name', () => {
    const s = launched()
    expect(s.runs).toEqual([expect.objectContaining({ id: RUN, name: 'probe-a', about: 'Probe run A', taskId: 'ww4as3j67', toolUseId: 'toolu_wf', startedAt: T })])
    expect(s.log[0]).toMatchObject({ kind: 'run', label: 'probe-a', say: { phrase: 'started' } })
    // the same answer again changes nothing and logs nothing
    expect(runLaunched(s, { runId: RUN, name: 'probe-a' }, T + 5).log).toHaveLength(1)
    // no id (outside a real run): no run
    expect(runLaunched(emptyTree(T), { runId: '' }, T).runs).toBeUndefined()
  })

  test('its agents join it: no spawn rows in the log, the run counts them', () => {
    let s = member(launched(), 'm1', 'a:apple', T + 10)
    s = member(s, 'm2', 'a:pear', T + 20)
    expect(s.agents.map(a => [a.id, a.run, a.workflow])).toEqual([
      ['m1', RUN, true],
      ['m2', RUN, true],
    ])
    expect(s.log).toHaveLength(1)
    expect(isMember(s, s.agents[0]!)).toBe(true)
    expect(runTally(s, s.runs![0]!)).toEqual({ total: 2, active: 2, waiting: 0, done: 0, failed: 0, stopped: 0 })
    // a finished agent is not logged; a failed one is
    s = turnCompleted(s, { agentId: 'm1', reason: 'answer' }, T + 30)
    expect(s.log).toHaveLength(1)
    s = turnCompleted(s, { agentId: 'm2', reason: 'error' }, T + 40)
    expect(s.log[0]).toMatchObject({ kind: 'failed', agentId: 'm2' })
    expect(runTally(s, s.runs![0]!)).toMatchObject({ total: 2, active: 0, done: 1, failed: 1 })
  })

  test('an agent spawned before its run was answered for starts the run itself', () => {
    const s = spawned(emptyTree(T), { agentId: 'm1', description: 'a:apple', type: 'workflow-subagent', workflow: true, run: RUN, toolUseId: 'toolu_wf' }, T)
    expect(s.runs).toEqual([expect.objectContaining({ id: RUN, toolUseId: 'toolu_wf' })])
    expect(s.log).toEqual([expect.objectContaining({ kind: 'run', label: 'workflow', say: { phrase: 'started' } })])
    // the answer then names it, and logs nothing more
    const named = runLaunched(s, { runId: RUN, name: 'probe-a', taskId: 'ww4as3j67' }, T + 5)
    expect(named.runs![0]).toMatchObject({ name: 'probe-a', taskId: 'ww4as3j67' })
    expect(named.log).toHaveLength(1)
  })

  test("an agent's turn.start before its spawn settles: a made-up row the spawn fills in, new, not resumed", () => {
    // checked live (plan 05): a workflow agent's turn.start comes before agent.spawn's next(e) settles
    let s = turnStarted(emptyTree(T), 'x1', 'task text', T)
    expect(s.agents[0]).toMatchObject({ id: 'x1', bare: true, state: 'running' })
    s = spawned(s, { agentId: 'x1', description: 'Check routes', type: 'general-purpose', model: 'claude-haiku-5-5' }, T + 5)
    expect(s.agents).toHaveLength(1)
    expect(s.agents[0]).toMatchObject({ id: 'x1', description: 'Check routes', type: 'general-purpose', state: 'running', startedAt: T })
    expect(s.agents[0]!.bare).toBeUndefined()
    expect(s.log[0]).toMatchObject({ kind: 'spawn', say: { phrase: 'spawned', value: 'Haiku 5.5' } })
    // a real resume (a known agent) still says so
    const again = spawned(s, { agentId: 'x1', description: 'Check routes', type: 'general-purpose' }, T + 9)
    expect(again.log[0]).toMatchObject({ say: { phrase: 'resumed' } })
  })

  test('its notification ends it: how, and after how long', () => {
    let s = member(launched(), 'm1', 'a:apple', T + 10)
    s = turnCompleted(s, { agentId: 'm1', reason: 'answer' }, T + 3000)
    // as the probe's notification reads (plan 05, 5.1)
    const text = [
      '<task-notification>',
      '<task-id>ww4as3j67</task-id>',
      '<tool-use-id>toolu_wf</tool-use-id>',
      '<output-file>C:\\tasks\\ww4as3j67.output</output-file>',
      '<status>completed</status>',
      '<summary>Dynamic workflow "Probe run A" completed</summary>',
      '<result>{"words":["apple"]}</result>',
      '<usage><agent_count>1</agent_count><agents_done>1</agents_done><agents_error>0</agents_error><duration_ms>3668</duration_ms></usage>',
      '</task-notification>',
    ].join('\n')
    const notices = taskNotices(text)
    expect(notices).toEqual([{ taskId: 'ww4as3j67', toolUseId: 'toolu_wf', status: 'completed', durationMs: 3668 }])
    const ended = runNoticed(s, notices[0]!, T + 9000)
    expect(ended.runs![0]).toMatchObject({ end: 'completed', endedAt: T + 3668 })
    expect(runEnded(ended.runs![0]!)).toBe(true)
    expect(ended.log[0]).toMatchObject({ kind: 'run', label: 'probe-a', say: { phrase: 'runDone', value: 1 }, ms: 3668 })
    // the same notification again changes nothing
    expect(runNoticed(ended, notices[0]!, T + 9500)).toBe(ended)
  })

  test("a failed or stopped run says so; its agents still at work stop; another task's notice is not its", () => {
    const s = member(launched(), 'm1', 'a:apple', T + 10)
    const failed = runNoticed(s, { toolUseId: 'toolu_wf', status: 'failed' }, T + 500)
    expect(failed.runs![0]).toMatchObject({ end: 'failed', endedAt: T + 500 })
    expect(failed.agents[0]).toMatchObject({ state: 'stopped' })
    expect(failed.log[0]).toMatchObject({ kind: 'run', say: { phrase: 'failed' } })
    expect(runNoticed(s, { taskId: 'ww4as3j67', status: 'killed' }, T + 500).log[0]).toMatchObject({ say: { phrase: 'stopped' } })
    // an agent's own notification (its id as task id) is no run's
    expect(runNoticed(s, { taskId: 'm1', toolUseId: 'toolu_other', status: 'completed' }, T + 500)).toBe(s)
    // several blocks in one text, a block with no status skipped
    expect(taskNotices('<task-notification><task-id>a</task-id><status>completed</status></task-notification> <task-notification><task-id>b</task-id></task-notification>')).toEqual([
      { taskId: 'a', toolUseId: undefined, status: 'completed', durationMs: undefined },
    ])
  })

  test('with no notification, a run nothing of which works is taken as ended after a while; a later agent opens it again', () => {
    let s = member(launched(), 'm1', 'a:apple', T + 10)
    s = turnCompleted(s, { agentId: 'm1', reason: 'answer' }, T + 1000)
    expect(settleRuns(s, T + 1000 + RUN_SETTLE_MS - 1)).toBe(s)
    const settled = settleRuns(s, T + 1000 + RUN_SETTLE_MS)
    expect(settled.runs![0]).toMatchObject({ settled: true, endedAt: T + 1000 })
    expect(settled.log[0]).toMatchObject({ kind: 'run', say: { phrase: 'runDone', value: 1 } })
    // a run with an agent at work is not taken as ended
    const busy = settleRuns(member(launched(), 'm1', 'a', T), T + 10 * RUN_SETTLE_MS)
    expect(busy.runs![0]!.settled).toBeUndefined()
    // a later phase's agent: it works again, and nothing more is logged
    const later = member(settled, 'm2', 'a:bash', T + 200_000)
    expect(runEnded(later.runs![0]!)).toBe(false)
    expect(later.log).toHaveLength(settled.log.length)
    // its notification then ends it, logged no second time
    const noticed = runNoticed(settled, { taskId: 'ww4as3j67', status: 'completed', durationMs: 900 }, T + 300_000)
    expect(noticed.runs![0]).toMatchObject({ end: 'completed', endedAt: T + 900 })
    expect(noticed.log).toHaveLength(settled.log.length)
  })

  test('a resumed run (the same id, a new call) opens again', () => {
    const ended = runNoticed(launched(), { taskId: 'ww4as3j67', status: 'failed' }, T + 100)
    const again = runLaunched(ended, { runId: RUN, name: 'probe-a', taskId: 'n2', toolUseId: 'toolu_2' }, T + 200)
    expect(again.runs).toHaveLength(1)
    // its time counts from the new call
    expect(again.runs![0]).toMatchObject({ taskId: 'n2', toolUseId: 'toolu_2', startedAt: T + 200 })
    expect(runEnded(again.runs![0]!)).toBe(false)
    expect(again.log[0]).toMatchObject({ kind: 'run', say: { phrase: 'started' } })
  })

  test('a stray agent no spawn named joins the one run at work; not with two, nor one the list knows', () => {
    let s = member(launched(), 'm1', 'a:apple', T)
    s = toolCalled(s, 'r1', 'Bash', { command: 'echo' }, T + 100)
    expect(adoptStrays(s, T + 100 + STRAY_MS - 1)).toBe(s)
    const adopted = adoptStrays(s, T + 100 + STRAY_MS)
    expect(adopted.agents.find(a => a.id === 'r1')).toMatchObject({ run: RUN, workflow: true })
    const two = runLaunched(s, { runId: 'wf_other' }, T + 50)
    expect(adoptStrays(two, T + 100 + STRAY_MS)).toBe(two)
    const known = listed(s, [{ id: 'r1', type: 'general-purpose', description: 'x', status: 'running' } as ListedAgent], T + 200)
    expect(adoptStrays(known, T + 100 + STRAY_MS).agents.find(a => a.id === 'r1')?.run).toBeUndefined()
    // a made-up row from before the run (an engine fork's, say) is not the run's, nor one no longer at work
    const before = toolCalled(emptyTree(T - 50_000), 'f1', 'Read', { file_path: 'x' }, T - 50_000)
    const run = member(runLaunched(before, { runId: RUN }, T), 'm1', 'a', T)
    expect(adoptStrays(run, T + 10 * STRAY_MS).agents.find(a => a.id === 'f1')?.run).toBeUndefined()
    const ended = turnCompleted(s, { agentId: 'r1', reason: 'answer' }, T + 200)
    expect(adoptStrays(ended, T + 100 + STRAY_MS).agents.find(a => a.id === 'r1')?.run).toBeUndefined()
  })

  test('trimming keeps a run whole: the agents it loses stay in its counts', () => {
    let s = launched()
    for (let i = 0; i < MAX_AGENTS + 5; i++) {
      s = member(s, `m${i}`, `a:${i}`, T + i)
      s = turnCompleted(s, { agentId: `m${i}`, reason: i === 0 ? 'error' : 'answer' }, T + 1000 + i)
    }
    expect(s.agents.length).toBe(MAX_AGENTS)
    expect(runTally(s, s.runs![0]!)).toMatchObject({ total: MAX_AGENTS + 5, done: MAX_AGENTS + 4, failed: 1 })
  })

  test("a notification waking main is not the person's prompt", () => {
    const s = turnStarted(emptyTree(T), undefined, 'Move the API to Rust', T)
    const woken = turnStarted(s, undefined, '<task-notification>\n<task-id>ww4as3j67</task-id>\n<status>completed</status>\n</task-notification>', T + 10)
    expect(woken.main).toMatchObject({ prompt: 'Move the API to Rust', isBusy: true })
  })
})

describe('the log in time order, the prompt the person sent last', () => {
  test("an entry that comes late takes its place by its time: a run's end the main took in after later spawns", () => {
    const RUN = 'wf_x'
    let s = runLaunched(emptyTree(T), { runId: RUN, name: 'one-word', taskId: 'tk' }, T)
    s = spawned(s, { agentId: 'm1', description: 'w1', type: 'workflow-subagent', workflow: true, run: RUN }, T + 100)
    s = turnCompleted(s, { agentId: 'm1', reason: 'answer' }, T + 1500)
    // another agent spawns a minute later; the run's notification only then
    s = spawned(s, { agentId: 'x1', description: 'Explore tests', type: 'Explore', model: 'claude-opus-5-5' }, T + 60_000)
    s = runNoticed(s, { taskId: 'tk', status: 'completed', durationMs: 2000 }, T + 61_000)
    expect(s.log.map(e => [e.at, e.say?.phrase])).toEqual([
      [T + 60_000, 'spawned'],
      [T + 2000, 'runDone'],
      [T, 'started'],
    ])
  })

  test('the newest entry stays first among those of one time', () => {
    let s = spawned(emptyTree(T), { agentId: 'a', description: 'A', type: 'Explore' }, T)
    s = spawned(s, { agentId: 'b', description: 'B', type: 'Explore' }, T)
    expect(s.log.map(e => e.label)).toEqual(['B', 'A'])
  })

  test("a prompt sent while a turn runs shows at once; a notification's text is no prompt", () => {
    const s = turnStarted(emptyTree(T), undefined, 'use a workflow: 3 Haiku agents', T)
    const next = prompted(s, 'review the hooks and the tests folder\nwith two Explore agents')
    expect(next.main.prompt).toBe('review the hooks and the tests folder')
    expect(next.main.isBusy).toBe(true)
    expect(prompted(next, '<task-notification>\n<task-id>x</task-id>\n</task-notification>')).toBe(next)
    expect(prompted(next, 'review the hooks and the tests folder')).toBe(next)
  })
})
