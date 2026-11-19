// A busy session for the layout tests, the one the plan's mockups show: the
// main turn on Opus with a Fable advisor, two Haiku explorers at work, one
// waiting agent, a finished test run, a failed review and three older
// finished explorers.
import type { TreeAgent, TreeState } from '../types'

// Local time, so the clock texts read the same in any time zone.
export const T0 = new Date(2026, 10, 18, 14, 0, 0).getTime()
export const NOW = T0 + 12 * 60_000

/** What `/model` offers, as the settings menu's model row lists it (Claude Code 2.1.328). */
export const OFFER = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']

function agent(id: string, fields: Partial<TreeAgent>): TreeAgent {
  return { id, description: id, type: 'Explore', state: 'running', since: T0, startedAt: T0, tools: 0, ...fields }
}

export function busyTree(): TreeState {
  return {
    startedAt: T0,
    main: {
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt: 'Move the API to Rust. Done means: every test passes',
      activity: 'Bash npm test',
      tools: 12,
      isBusy: true,
      turnStartedAt: T0,
      contextPercent: 47,
      contextTokens: 94_000,
      contextWindow: 200_000,
      lastTurnTokens: 94_000,
      turnDelta: 23_700,
      costUsd: 1.84,
      limits: [
        { kind: 'five_hour', percent: 23, resetsAt: new Date(NOW + (2 * 60 + 12) * 60_000).toISOString() },
        { kind: 'seven_day', percent: 41, resetsAt: new Date(NOW + (2 * 24 + 4) * 3_600_000).toISOString() },
      ],
    },
    agents: [
      agent('old1', { description: 'Map the repo', model: 'claude-haiku-5-5', state: 'done', startedAt: T0, endedAt: T0 + 60_000 }),
      agent('old2', { description: 'List API routes', model: 'claude-haiku-5-5', state: 'done', startedAt: T0, endedAt: T0 + 70_000 }),
      agent('old3', { description: 'Read the specs', model: 'claude-haiku-5-5', state: 'done', startedAt: T0, endedAt: T0 + 80_000 }),
      agent('a1', {
        description: 'Find auth handlers',
        model: 'claude-haiku-5-5',
        effort: 'low',
        advisorCalls: 1,
        startedAt: NOW - 38_000,
        activity: 'Grep src/auth/**',
        tools: 23,
        tokens: 21_000,
        window: 116_000,
        samples: [2000, 6000, 9000, 14000, 18000, 21000],
        costUsd: 0.04,
      }),
      agent('a2', {
        description: 'Scan API routes',
        model: 'claude-haiku-5-5',
        effort: 'low',
        startedAt: NOW - 31_000,
        activity: 'Read routes/user.ts',
        tools: 9,
        tokens: 14_000,
        window: 116_000,
      }),
      agent('w1', {
        description: 'Migrate session store',
        type: 'general-purpose',
        model: 'claude-sonnet-5-5',
        effort: 'medium',
        state: 'waiting',
        startedAt: NOW - 60_000,
        costUsd: 0.11,
      }),
      agent('t1', {
        description: 'Run test suite',
        type: 'test-runner',
        model: 'claude-sonnet-5-5',
        state: 'done',
        startedAt: NOW - 200_000,
        endedAt: NOW - 128_000,
        tools: 14,
      }),
      agent('r1', {
        description: 'Review auth diff',
        type: 'reviewer',
        model: 'claude-opus-5-5',
        state: 'failed',
        endReason: 'error',
        startedAt: NOW - 150_000,
        endedAt: NOW - 106_000,
        costUsd: 0.21,
      }),
    ],
    advisor: {
      model: 'claude-fable-5-2',
      total: 3,
      calls: [
        { at: NOW - 600_000, ms: 3900 },
        { at: NOW - 300_000, ms: 5200, by: 'a1' },
        { at: NOW - 120_000, ms: 4100 },
      ],
    },
    choices: { offer: [...OFFER], modelSetting: 'opus' },
    log: [
      { at: NOW - 120_000, kind: 'advisor', label: 'advisor', text: 'called by main', say: { phrase: 'calledBy', value: 'main' }, right: '4.1s', ms: 4100 },
      { at: NOW - 125_000, kind: 'waiting', agentId: 'w1', label: 'Migrate session store', text: 'waiting', say: { phrase: 'waiting' } },
      { at: NOW - 128_000, kind: 'done', agentId: 't1', label: 'Run test suite', text: 'done · 14 tools', say: { phrase: 'done', value: 14 }, right: '1m12s', ms: 72_000 },
      { at: NOW - 160_000, kind: 'failed', agentId: 'r1', label: 'Review auth diff', text: 'error', say: { phrase: 'error' }, right: '44s', ms: 44_000 },
      // as an older version wrote it: the text alone
      { at: NOW - 170_000, kind: 'spawn', agentId: 'a2', label: 'Scan API routes', text: 'spawned · Haiku 5.5' },
      { at: NOW - 180_000, kind: 'spawn', agentId: 'a1', label: 'Find auth handlers', text: 'spawned · Haiku 5.5', say: { phrase: 'spawned', value: 'Haiku 5.5' } },
    ],
  }
}

/**
 * The busy session with workflow runs too (plan 05): `review-changes` at work
 * with six agents (one working, one failed, four done), and `lint-sweep`, which
 * ended well earlier with three.
 */
export function workflowTree(): TreeState {
  const s = busyTree()
  const member = (id: string, run: string, fields: Partial<TreeAgent>): TreeAgent =>
    agent(id, { type: 'workflow-subagent', model: 'claude-haiku-5-5', effort: 'low', workflow: true, run, ...fields })
  const lint = Array.from({ length: 3 }, (_, i) =>
    member(`l${i + 1}`, 'wf_lint', { description: `lint:${i + 1}`, state: 'done', startedAt: NOW - 500_000, endedAt: NOW - 470_000 + i * 1000 }),
  )
  const review = [
    member('m1', 'wf_review', { description: 'verify:auth.ts', startedAt: NOW - 12_000, activity: 'Grep src/auth/**', tools: 3 }),
    member('m2', 'wf_review', { description: 'verify:db.ts', state: 'failed', endReason: 'error', startedAt: NOW - 80_000, endedAt: NOW - 49_000 }),
    ...['api', 'ui', 'cli', 'docs'].map((x, i) =>
      member(`m${i + 3}`, 'wf_review', { description: `review:${x}`, state: 'done', startedAt: NOW - 100_000, endedAt: NOW - 60_000 + i * 1000 }),
    ),
  ]
  return {
    ...s,
    agents: [...s.agents, ...lint, ...review],
    runs: [
      { id: 'wf_lint', name: 'lint-sweep', about: 'Lint every package', taskId: 'tl', startedAt: NOW - 500_000, endedAt: NOW - 460_000, end: 'completed' },
      { id: 'wf_review', name: 'review-changes', about: 'Review changed files across dimensions', taskId: 'tr', toolUseId: 'tu_wf', startedAt: NOW - 102_000 },
    ],
    log: [
      { at: NOW - 102_000, kind: 'run', label: 'review-changes', text: 'started', say: { phrase: 'started' } },
      { at: NOW - 460_000, kind: 'run', label: 'lint-sweep', text: 'done · × 3', say: { phrase: 'runDone', value: 3 }, right: '40s', ms: 40_000 },
      ...s.log,
    ],
  }
}
