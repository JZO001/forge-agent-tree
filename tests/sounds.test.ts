import { describe, expect, test } from 'claude-code/testing'

import { ANY_GAP_MS, SOUND_GAP_MS, heardOf, isCritical, pickSound, soundEvents } from '../hooks/sounds'
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

  test('several at once come in order of what needs the person most', () => {
    const s = withAgents(busyTree(), [agent('n1', {}), agent('n2', {})])
    const before = heardOf(s)
    const next: TreeState = { ...withAgents(s, [agent('n1', { state: 'done' }), agent('n2', { state: 'failed' })]), main: { ...s.main, isBusy: false, contextPercent: 93 } }
    expect(soundEvents(before, next)).toEqual(['alert', 'failed', 'turn', 'done'])
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
