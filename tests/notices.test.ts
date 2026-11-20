import { describe, expect, test } from 'claude-code/testing'

import { NOTICE_DELAY_MS, NOTICE_EVENTS, NOTICE_GAP_MS, NOTICE_OPTION, clean, nextNotices, noticeText, noticesOf, testSaid, toastScript, xmlChars } from '../hooks/notices'
import type { Notice, NoticeEvent } from '../hooks/notices'
import { heardChanges, heardOf } from '../hooks/sounds'
import { DEFAULT_SETTINGS } from '../hooks/layout'
import { wordsFor } from '../hooks/words'
import type { TreeAgent, TreeState } from '../types'
import { NOW, busyTree, workflowTree } from './fixture'

const EN = wordsFor('en')

function agent(id: string, fields: Partial<TreeAgent>): TreeAgent {
  return { id, description: id, type: 'Explore', state: 'running', since: NOW, startedAt: NOW, tools: 0, ...fields }
}
function withAgents(s: TreeState, agents: TreeAgent[]): TreeState {
  return { ...s, agents }
}
/** What the change from `before` to `after` notifies, in English. */
function tell(before: TreeState, after: TreeState): Notice[] {
  return noticesOf(heardChanges(heardOf(before), after), after, EN)
}
const all = (): boolean => true

describe('what a change of state notifies (plan 12)', () => {
  test('nothing changed, nothing is notified', () => {
    const s = busyTree()
    expect(tell(s, s)).toEqual([])
  })

  test('an agent that starts waiting, by its name; one that fails; one deployed or done says nothing', () => {
    const s = withAgents(busyTree(), [agent('n1', { description: 'Find auth handlers' })])
    const turned = (state: TreeAgent['state']) => withAgents(s, [agent('n1', { description: 'Find auth handlers', state })])
    expect(tell(s, turned('waiting'))).toEqual([{ event: 'waiting', items: ['Find auth handlers'] }])
    expect(tell(s, turned('failed'))).toEqual([{ event: 'failed', items: ['Find auth handlers'] }])
    expect(tell(s, turned('done'))).toEqual([])
    expect(tell(withAgents(s, []), s)).toEqual([])
  })

  test('a workflow run: its agent that fails, the run that fails by its name, the run that ends well with its count and length', () => {
    const s = workflowTree()
    const member = s.agents.find(a => a.run === 'wf_review' && a.state === 'running')!
    const failed: TreeState = { ...s, agents: s.agents.map(a => (a.id === member.id ? { ...a, state: 'failed' as const } : a)) }
    expect(tell(s, failed)).toEqual([{ event: 'failed', items: ['verify:auth.ts'] }])
    // its agents ending well say nothing; the run's own end does
    const done: TreeState = { ...s, agents: s.agents.map(a => (a.id === member.id ? { ...a, state: 'done' as const } : a)) }
    expect(tell(s, done)).toEqual([])
    const ended: TreeState = { ...s, runs: (s.runs ?? []).map(r => (r.id === 'wf_review' ? { ...r, end: 'completed' as const, endedAt: r.startedAt + 102_000 } : r)) }
    expect(tell(s, ended)).toEqual([{ event: 'run', items: ['review-changes · × 6 · 1m42s'] }])
    const broke: TreeState = { ...s, runs: (s.runs ?? []).map(r => (r.id === 'wf_review' ? { ...r, end: 'failed' as const, endedAt: NOW } : r)) }
    expect(tell(s, broke)).toEqual([{ event: 'failed', items: ['review-changes'] }])
  })

  test('the main turn’s end by its prompt; the alert by what reached its red mark; an advisor call says nothing', () => {
    const s = busyTree()
    expect(tell(s, { ...s, main: { ...s.main, isBusy: false } })).toEqual([{ event: 'turn', items: ['Move the API to Rust. Done means: every test passes'] }])
    expect(tell(s, { ...s, advisor: { ...s.advisor, total: s.advisor.total + 1 } })).toEqual([])
    expect(tell(s, { ...s, main: { ...s.main, contextPercent: 91.6 } })).toEqual([{ event: 'alert', items: ['ctx 92%'] }])
    const limits = [
      { kind: 'five_hour', percent: 91 },
      { kind: 'seven_day', percent: 95 },
    ]
    expect(tell(s, { ...s, main: { ...s.main, limits } })).toEqual([{ event: 'alert', items: ['session 91% · all 95%'] }])
    // the red mark as set: at 80 here
    const t = { warn: 60, alert: 80 }
    const hot: TreeState = { ...s, main: { ...s.main, limits: [{ kind: 'five_hour', percent: 82 }] } }
    expect(noticesOf(heardChanges(heardOf(s, t), hot, t), hot, EN, t)).toEqual([{ event: 'alert', items: ['session 82%'] }])
  })

  test('several at once: one notice a kind, in the page’s order', () => {
    const s = withAgents(busyTree(), [agent('n1', {}), agent('n2', {})])
    const after: TreeState = { ...withAgents(s, [agent('n1', { state: 'failed' }), agent('n2', { state: 'waiting' })]), main: { ...s.main, isBusy: false } }
    expect(tell(s, after).map(n => n.event)).toEqual(['waiting', 'failed', 'turn'])
  })
})

describe('the text', () => {
  test('the event’s name, then what of it; several merged show their count', () => {
    expect(noticeText({ event: 'waiting', items: ['Find auth handlers'] }, EN)).toBe('Agent waiting: Find auth handlers')
    expect(noticeText({ event: 'failed', items: ['verify:db.ts', 'review-changes', 'Review auth diff'] }, EN)).toBe('Failure (3): verify:db.ts, review-changes, Review auth diff')
    expect(noticeText({ event: 'run', items: ['review-changes · × 6 · 1m42s'] }, EN)).toBe('Workflow done: review-changes · × 6 · 1m42s')
    expect(noticeText({ event: 'alert', items: ['session 91%'] }, EN)).toBe('Red alert: session 91%')
    // a turn with no prompt: the event's name alone
    expect(noticeText({ event: 'turn', items: [''] }, EN)).toBe('Turn complete')
  })

  test('in the pane’s language, in every one of them', () => {
    expect(noticeText({ event: 'waiting', items: ['Find auth handlers'] }, wordsFor('hu'))).toBe('Agent vár: Find auth handlers')
    expect(noticeText({ event: 'failed', items: ['a', 'b'] }, wordsFor('hu'))).toBe('Hiba (2): a, b')
    for (const lang of ['de', 'ja', 'el', 'tr'] as const) {
      const w = wordsFor(lang)
      for (const e of NOTICE_EVENTS) expect(noticeText({ event: e, items: ['x'] }, w)).toBe(`${w.options.labels[NOTICE_OPTION[e]]}: x`)
    }
  })

  test('a name the model wrote cannot break the terminal’s sequence: no control characters, one line, cut', () => {
    expect(clean('evil\u001b]9;pwned\u0007name', 80)).toBe('evil ]9;pwned name')
    expect(clean('two\nlines\r\n\tand tabs', 80)).toBe('two lines and tabs')
    expect(clean('‮right to left⁦', 80)).toBe('right to left')
    expect(clean('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`)
    const text = noticeText({ event: 'failed', items: ['x\u001b[31m'.repeat(40), 'y'] }, EN)
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(text)).toBe(false)
    expect(text.length <= 200).toBe(true)
  })
})

describe('when they go out', () => {
  const failure = (...items: string[]): Notice => ({ event: 'failed', items })

  test('the first of a kind at once; what comes within 30 s waits, then goes out merged', () => {
    const last: Partial<Record<NoticeEvent, number>> = {}
    const first = nextNotices({}, [failure('a')], all, last, NOW)
    expect(first.send).toEqual([failure('a')])
    expect(first.queue).toEqual({})
    last.failed = NOW
    const held = nextNotices(first.queue, [failure('b')], all, last, NOW + 5000)
    expect(held.send).toEqual([])
    const more = nextNotices(held.queue, [failure('c', 'b')], all, last, NOW + 10_000)
    expect(more.send).toEqual([])
    expect(more.queue).toEqual({ failed: ['b', 'c'] })
    // nothing new: still waiting until the gap has passed
    expect(nextNotices(more.queue, [], all, last, NOW + NOTICE_GAP_MS - 1).send).toEqual([])
    expect(nextNotices(more.queue, [], all, last, NOW + NOTICE_GAP_MS)).toEqual({ queue: {}, send: [failure('b', 'c')] })
  })

  test('kinds keep their own gaps', () => {
    const last: Partial<Record<NoticeEvent, number>> = { failed: NOW }
    const out = nextNotices({}, [failure('a'), { event: 'waiting', items: ['w'] }], all, last, NOW + 1000)
    expect(out.send).toEqual([{ event: 'waiting', items: ['w'] }])
    expect(out.queue).toEqual({ failed: ['a'] })
  })

  test('the main turn’s end and the alert keep only the latest', () => {
    const last: Partial<Record<NoticeEvent, number>> = { turn: NOW, alert: NOW }
    const one = nextNotices({}, [{ event: 'turn', items: ['first'] }, { event: 'alert', items: ['ctx 91%'] }], all, last, NOW + 1000)
    const two = nextNotices(one.queue, [{ event: 'turn', items: ['second'] }, { event: 'alert', items: ['session 92%'] }], all, last, NOW + 2000)
    expect(two.queue).toEqual({ turn: ['second'], alert: ['session 92%'] })
  })

  test('a kind switched off is not sent, and what waited of it is dropped', () => {
    const off = (e: NoticeEvent): boolean => e !== 'failed'
    expect(nextNotices({}, [failure('a')], off, {}, NOW)).toEqual({ queue: {}, send: [] })
    expect(nextNotices({ failed: ['a'] }, [], off, { failed: NOW }, NOW + 1000)).toEqual({ queue: {}, send: [] })
  })

  test('a host holds one 20 s, less than the gap, so a newer one of a kind never replaces one still held', () => {
    expect(NOTICE_DELAY_MS).toBe(20_000)
    expect(NOTICE_DELAY_MS < NOTICE_GAP_MS).toBe(true)
  })

  test('every event is on by default, and so is the switch for them all (the user’s decision of 2026-11-20)', () => {
    expect(DEFAULT_SETTINGS.notify).toBe(true)
    for (const e of NOTICE_EVENTS) expect(DEFAULT_SETTINGS[NOTICE_OPTION[e]], e).toBe(true)
  })
})

describe('a Windows notification where Claude Code has no channel (plan 14)', () => {
  /** What the XML parser reads back from character references. */
  const unxml = (text: string) => text.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  /** Quotes of every kind PowerShell ends a string on, and what a script could run with. */
  const evil = "it’s ‘a’ \"b\" 'c' `d` $(Remove-Item x) & <f> ‚g‛ “h” ünnep 漢字 😀"

  test('the text goes as character references: letters, digits and spaces as they are, nothing that could end a quoted string', () => {
    const enc = xmlChars(evil)
    expect(/^([A-Za-z0-9 ]|&#\d+;)*$/.test(enc)).toBe(true)
    expect(unxml(enc)).toBe(evil)
    // a code point XML cannot hold becomes U+FFFD
    expect(xmlChars('a\uD800b')).toBe('a&#65533;b')
  })

  test('the script holds the title and the text only as references: its quotes are its own', () => {
    const script = toastScript('Agent Tree // Forge', evil)
    expect(script).toContain(xmlChars(evil))
    // as many single quotes as with a plain text: none came from the text
    expect(script.split("'").length).toBe(toastScript('A', 'B').split("'").length)
    for (const quote of ['‘', '’', '‚', '‛', '`', '$(']) expect(script.includes(quote), quote).toBe(false)
    expect(script).toContain("CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')")
  })

  test('no double quote of any kind in the script: the command line’s quoting has nothing to escape; silent, one per kind', () => {
    const script = toastScript('Agent Tree // Forge', evil, 'waiting')
    for (const quote of ['"', '“', '”', '„']) expect(script.includes(quote), quote).toBe(false)
    // silent: the mod's own sounds speak
    expect(script).toContain("<audio silent=''true''/>")
    // a newer one of a kind replaces the older in the notification center
    expect(script).toContain("$t.Tag = 'waiting'")
    expect(script).toContain("$t.Group = 'forge'")
    expect(toastScript('t', 'x', "a'b; Remove-Item")).toContain("$t.Tag = 'abRemove-Item'")
  })

  test('what a test says came of it, in words no one takes for the notification itself', () => {
    expect(testSaid({ kind: 'sent', channel: 'client' }, EN)).toBe('Agent Tree // Forge: test notification sent (client)')
    expect(testSaid({ kind: 'windows' }, EN)).toBe('Agent Tree // Forge: sent as a Windows notification · Claude Code has no notification channel in this terminal')
    expect(testSaid({ kind: 'not', reason: 'no-channel' }, EN)).toBe('Agent Tree // Forge: no notification was shown (no-channel) · Claude Code has no notification channel in this terminal · /config')
    expect(testSaid({ kind: 'not', reason: 'disabled' }, EN)).toBe('Agent Tree // Forge: no notification was shown (disabled) · notifications are off in Claude Code · /config')
    expect(testSaid({ kind: 'not', reason: 'refused' }, EN)).toBe('Agent Tree // Forge: no notification was shown (refused)')
    expect(testSaid({ kind: 'windows' }, wordsFor('hu'))).toBe('Agent Tree // Forge: Windows-értesítésként elküldve · a Claude Code-nak nincs értesítési csatornája ebben a terminálban')
    // Greek writes no `;`: it is the question mark there
    for (const outcome of [{ kind: 'windows' as const }, { kind: 'not' as const, reason: 'no-channel' }, { kind: 'not' as const, reason: 'disabled' }]) {
      expect(testSaid(outcome, wordsFor('el')).includes(';')).toBe(false)
    }
  })
})
