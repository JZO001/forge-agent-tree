import { describe, expect, test } from 'claude-code/testing'

import { ANY_GAP_MS, SOUND_GAP_MS, SOUND_WAIT_MS, heardOf, isCritical, nextSound, pickSound, soundEvents } from '../hooks/sounds'
import type { SoundEvent } from '../hooks/sounds'
import type { TreeAgent, TreeState } from '../types'
import { NOW, busyTree, workflowTree } from './fixture'

function agent(id: string, fields: Partial<TreeAgent>): TreeAgent {
  return { id, description: id, type: 'Explore', state: 'running', since: NOW, startedAt: NOW, tools: 0, ...fields }
}
function withAgents(s: TreeState, agents: TreeAgent[]): TreeState {
  return { ...s, agents }
}

describe('what a change of state sounds', () => {
  test('nothing changed, nothing sounds', () => {
    const s = busyTree()
    expect(soundEvents(heardOf(s), s)).toEqual([])
  })

  test('a new agent at work deploys; one first seen ended, or not yet named by its spawn, says nothing', () => {
    const s = withAgents(busyTree(), [])
    const before = heardOf(s)
    expect(soundEvents(before, withAgents(s, [agent('n1', {})]))).toEqual(['spawn'])
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'done' })]))).toEqual([])
    expect(soundEvents(before, withAgents(s, [agent('n1', { bare: true })]))).toEqual([])
  })

  test('done, failed and waiting each when an agent turns so', () => {
    const s = withAgents(busyTree(), [agent('n1', {})])
    const before = heardOf(s)
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'done' })]))).toEqual(['done'])
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'failed' })]))).toEqual(['failed'])
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'waiting' })]))).toEqual(['waiting'])
  })

  test('a workflow run’s agents: no deploy and no done, a failure yes; the run’s own end sounds', () => {
    const s = workflowTree()
    const before = heardOf(s)
    // a new agent of a run at work: no deploy (review of 2026-11-20: never checked)
    const joined: TreeState = { ...s, agents: [...s.agents, agent('m9', { run: 'wf_review', workflow: true })] }
    expect(soundEvents(before, joined)).toEqual([])
    const member = s.agents.find(a => a.run === 'wf_review' && a.state === 'running')!
    const done: TreeState = { ...s, agents: s.agents.map(a => (a.id === member.id ? { ...a, state: 'done' as const } : a)) }
    expect(soundEvents(before, done)).toEqual([])
    const failed: TreeState = { ...s, agents: s.agents.map(a => (a.id === member.id ? { ...a, state: 'failed' as const } : a)) }
    expect(soundEvents(before, failed)).toEqual(['failed'])
    const ended: TreeState = { ...s, runs: (s.runs ?? []).map(r => (r.id === 'wf_review' ? { ...r, end: 'completed' as const, endedAt: NOW } : r)) }
    expect(soundEvents(before, ended)).toEqual(['done'])
    const broke: TreeState = { ...s, runs: (s.runs ?? []).map(r => (r.id === 'wf_review' ? { ...r, end: 'failed' as const, endedAt: NOW } : r)) }
    expect(soundEvents(before, broke)).toEqual(['failed'])
  })

  test('the main turn’s end, an advisor call, and the alert when the context or a limit reaches its red mark', () => {
    const s = busyTree()
    const before = heardOf(s)
    expect(soundEvents(before, { ...s, main: { ...s.main, isBusy: false } })).toEqual(['turn'])
    expect(soundEvents(before, { ...s, advisor: { ...s.advisor, total: s.advisor.total + 1 } })).toEqual(['advisor'])
    const hot: TreeState = { ...s, main: { ...s.main, contextPercent: 91 } }
    expect(isCritical(hot)).toBe(true)
    expect(soundEvents(before, hot)).toEqual(['alert'])
    // only on the way up: still critical is no new alert
    expect(soundEvents(heardOf(hot), hot)).toEqual([])
    // a limit at its red mark: 90% by default (the user's choice of 2026-11-20); 85% is not there yet
    expect(soundEvents(before, { ...s, main: { ...s.main, limits: [{ kind: 'five_hour', percent: 92 }] } })).toEqual(['alert'])
    expect(soundEvents(before, { ...s, main: { ...s.main, limits: [{ kind: 'five_hour', percent: 85 }] } })).toEqual([])
    // an estimate of the context is not measured: it raises no alert
    expect(isCritical({ ...s, main: { ...s.main, contextPercent: 95, contextEstimated: true } })).toBe(false)
  })

  test('one started since the last hearing and already ended sounds as it ended; one first seen long ended does not (review of 2026-11-20)', () => {
    const s = withAgents(busyTree(), [])
    const before = heardOf(s, undefined, NOW)
    // a subagent whose first request failed at once: spawned and failed between two hearings
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'failed', startedAt: NOW + 50, endedAt: NOW + 60 })]))).toEqual(['failed'])
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'done', startedAt: NOW + 50, endedAt: NOW + 90 })]))).toEqual(['done'])
    // found by the list already ended, long ago: nothing
    expect(soundEvents(before, withAgents(s, [agent('n1', { state: 'failed', startedAt: NOW - 600_000 })]))).toEqual([])
    // a run that launched and failed between two hearings sounds; one first seen long ended does not
    const w = workflowTree()
    const heard = heardOf({ ...w, runs: [] }, undefined, NOW)
    const failedRun: TreeState = { ...w, runs: (w.runs ?? []).map(r => ({ ...r, startedAt: NOW + 10, end: 'failed' as const, endedAt: NOW + 20 })) }
    expect(soundEvents(heard, failedRun)).toContain('failed')
    const oldRun: TreeState = { ...w, agents: [], runs: (w.runs ?? []).map(r => ({ ...r, startedAt: NOW - 600_000, end: 'completed' as const, endedAt: NOW - 500_000 })) }
    expect(soundEvents(heardOf({ ...oldRun, runs: [] }, undefined, NOW), oldRun)).toEqual([])
  })

  test('a stray a run took in is heard: its failure sounds (review of 2026-11-20)', () => {
    const w = workflowTree()
    const run = (w.runs ?? []).find(r => !r.end && !r.settled)!
    const stray = agent('r1', { bare: true, run: run.id, workflow: true })
    const s = withAgents(w, [...w.agents, stray])
    const before = heardOf(s, undefined, NOW)
    expect(before.agents.r1).toBe('running')
    expect(soundEvents(before, withAgents(w, [...w.agents, { ...stray, state: 'failed' }]))).toEqual(['failed'])
    // a made-up row no run took in is still not heard
    expect(heardOf(withAgents(w, [agent('x1', { bare: true })])).agents.x1).toBeUndefined()
  })

  test('a run taken as ended with a failed agent sounds failed; a stopped run, and a stopped agent, sound nothing (review of 2026-11-20)', () => {
    const s = workflowTree()
    const before = heardOf(s)
    const id = 'wf_review'
    // its last agent ends well (a member's end sounds nothing); one of its agents had failed (m2)
    const quiet = s.agents.map(a => (a.run === id && a.state === 'running' ? { ...a, state: 'done' as const } : a))
    const settled: TreeState = { ...s, agents: quiet, runs: (s.runs ?? []).map(r => (r.id === id ? { ...r, settled: true, endedAt: NOW } : r)) }
    expect(soundEvents(before, settled)).toEqual(['failed'])
    const killed: TreeState = { ...s, runs: (s.runs ?? []).map(r => (r.id === id ? { ...r, end: 'killed' as const, endedAt: NOW } : r)) }
    expect(soundEvents(before, killed)).toEqual([])
    const lone = withAgents(busyTree(), [agent('n1', {})])
    expect(soundEvents(heardOf(lone), withAgents(lone, [agent('n1', { state: 'stopped' })]))).toEqual([])
  })

  test('several at once come in order of what needs the person most', () => {
    const s = withAgents(busyTree(), [agent('n1', {}), agent('n2', {})])
    const before = heardOf(s)
    const next: TreeState = { ...withAgents(s, [agent('n1', { state: 'done' }), agent('n2', { state: 'failed' })]), main: { ...s.main, isBusy: false, contextPercent: 93 } }
    expect(soundEvents(before, next)).toEqual(['alert', 'failed', 'turn', 'done'])
  })
})

describe('the sounds waiting their turn (review of 2026-11-20)', () => {
  const all = (): boolean => true
  test('what a more important sound or the common gap held back sounds after it, until it has waited too long', () => {
    // two at once: the more important now, the other waits
    let q = nextSound({}, ['failed', 'done'], all, {}, NOW)
    expect(q.play).toBe('failed')
    expect(Object.keys(q.queue)).toEqual(['done'])
    const last: Record<string, number> = { failed: NOW, any: NOW }
    // within the common gap: still waiting
    q = nextSound(q.queue, [], all, last, NOW + ANY_GAP_MS - 1)
    expect(q.play).toBeUndefined()
    // after it: its turn
    q = nextSound(q.queue, [], all, last, NOW + ANY_GAP_MS)
    expect(q.play).toBe('done')
    expect(q.queue).toEqual({})
    // one that waited longer than it may is let go
    const held = nextSound({}, ['turn'], all, { any: NOW }, NOW)
    expect(held.play).toBeUndefined()
    expect(nextSound(held.queue, [], all, { any: NOW }, NOW + SOUND_WAIT_MS + 1)).toEqual({ queue: {} })
  })

  test('one switched off never waits; one that has just sounded is not sounded again for the same burst', () => {
    expect(nextSound({}, ['spawn'], e => e !== 'spawn', {}, NOW)).toEqual({ queue: {} })
    // the same event within its own gap: told already, nothing new waits
    expect(nextSound({}, ['done'], all, { done: NOW - 100, any: NOW - 100 }, NOW)).toEqual({ queue: {} })
  })
})

describe('which sounds now', () => {
  const all = (): boolean => true
  test('the first switched on, unless it sounded within its gap or any did within the common one', () => {
    const events: SoundEvent[] = ['failed', 'done']
    expect(pickSound(events, all, {}, NOW)).toBe('failed')
    expect(pickSound(events, e => e !== 'failed', {}, NOW)).toBe('done')
    expect(pickSound(events, all, { failed: NOW - 100 }, NOW)).toBe('done')
    expect(pickSound(events, all, { failed: NOW - SOUND_GAP_MS }, NOW)).toBe('failed')
    expect(pickSound(events, all, { any: NOW - ANY_GAP_MS + 1 }, NOW)).toBeUndefined()
    expect(pickSound([], all, {}, NOW)).toBeUndefined()
  })
})
