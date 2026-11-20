/**
 * The pane's notifications (plan 12, the user's decisions of 2026-11-20): a
 * native notification through the person's own channel when an agent waits for
 * them, something fails, a workflow run finishes, the main answer is done, or a
 * red alert rises; each event with a switch of its own under one switch for
 * them all, on by default. Only decisions here: what a change of state tells
 * (from the same hearing as the sounds), what waits to be merged, and the text.
 * register.tsx sends them.
 */
import type { TreeNotice, TreeState } from '../types'
import { LIMIT_THRESHOLDS, cut, duration } from './format'
import type { LimitThresholds } from './format'
import { labelOf, runLabel, runTally } from './model'
import { CRITICAL_CONTEXT } from './sounds'
import type { Change } from './sounds'
import { NAME } from './words'
import type { OptionField, Words } from './words'

export type NoticeEvent = 'waiting' | 'failed' | 'run' | 'turn' | 'alert'

/** The events in the order the notifications page lists them. */
export const NOTICE_EVENTS: readonly NoticeEvent[] = ['waiting', 'failed', 'run', 'turn', 'alert']

/** Each event's switch among the options. */
export const NOTICE_OPTION: Readonly<Record<NoticeEvent, OptionField>> = {
  waiting: 'notifyWaiting',
  failed: 'notifyFailed',
  run: 'notifyRun',
  turn: 'notifyTurn',
  alert: 'notifyAlert',
}

/** One kind at most this often; what comes meanwhile waits and goes out merged into one. */
export const NOTICE_GAP_MS = 30_000
/**
 * How long a host (the desktop app, a remote client) holds one before raising
 * it; it drops it when the person comes back first (`untilBack`), so it only
 * reaches someone who left. A terminal has no such thing and sends at once.
 * Shorter than the gap, so a newer one of a kind never replaces one still held.
 */
export const NOTICE_DELAY_MS = 20_000
/** A name in a notification at most this many cells; the whole text at most `TEXT_CELLS`. */
const ITEM_CELLS = 48
const TEXT_CELLS = 200

/** What a notification tells: its kind, and what of it (a name each; the main turn's prompt; the alert's shares). */
export type Notice = { event: NoticeEvent; items: string[] }

/** The notifications waiting their kind's gap, to go out merged: each kind's items. */
export type NoticeQueue = Partial<Record<NoticeEvent, string[]>>

/** Kinds that tell of one thing at a time: a newer one replaces what waits. */
const LATEST_ONLY: readonly NoticeEvent[] = ['turn', 'alert']

/**
 * What the changes tell as notifications, one per kind: an agent that waits; an
 * agent or a run that failed; a run that finished well (an agent's own end is
 * too frequent to notify); the main turn's end, by its prompt; the alert, by
 * what reached its red mark.
 */
export function noticesOf(changes: readonly Change[], s: TreeState, w: Words, thresholds?: LimitThresholds): Notice[] {
  const items: Partial<Record<NoticeEvent, string[]>> = {}
  const add = (e: NoticeEvent, item: string): void => {
    ;(items[e] ??= []).push(item)
  }
  for (const c of changes) {
    if (c.event === 'waiting' && c.agent) add('waiting', labelOf(c.agent))
    else if (c.event === 'failed' && c.agent) add('failed', labelOf(c.agent))
    else if (c.event === 'failed' && c.run) add('failed', runLabel(c.run))
    else if (c.event === 'done' && c.run) add('run', runItem(s, c.run, w))
    else if (c.event === 'turn') add('turn', s.main.prompt ?? '')
    else if (c.event === 'alert') add('alert', alertItem(s, w, thresholds))
  }
  return NOTICE_EVENTS.flatMap(e => (items[e] ? [{ event: e, items: items[e]! }] : []))
}

/** A finished run: its name, how many agents it had, how long it took (`review-changes · × 6 · 1m42s`). */
function runItem(s: TreeState, r: NonNullable<Change['run']>, w: Words): string {
  const parts = [runLabel(r), `× ${runTally(s, r).total}`]
  if (r.endedAt !== undefined) parts.push(duration(Math.max(0, r.endedAt - r.startedAt), w.lang))
  return parts.join(' · ')
}

/** What reached its red mark: the measured context, a limit (`ctx 92%`, `session 91%`). */
function alertItem(s: TreeState, w: Words, thresholds: LimitThresholds = LIMIT_THRESHOLDS): string {
  const parts: string[] = []
  const ctx = s.main.contextPercent
  if (ctx !== undefined && !s.main.contextEstimated && ctx >= CRITICAL_CONTEXT) parts.push(`ctx ${Math.round(ctx)}%`)
  for (const l of s.main.limits ?? []) {
    if (l.percent >= thresholds.alert) parts.push(`${l.kind === 'five_hour' ? w.session : l.kind === 'seven_day' ? w.allModels : l.kind} ${Math.round(l.percent)}%`)
  }
  return parts.join(' · ')
}

/**
 * The notifications that go out now, and what waits (the user's decision of
 * 2026-11-20: a kind at most every 30 s, what comes meanwhile merged into the
 * next). A raised kind switched on joins what waits of it (a name once); the
 * main turn's end and the alert keep only the latest. A kind goes out once its
 * gap since its last one has passed; a kind switched off is dropped.
 */
export function nextNotices(
  queue: NoticeQueue,
  raised: readonly Notice[],
  on: (e: NoticeEvent) => boolean,
  last: Readonly<Partial<Record<NoticeEvent, number>>>,
  now: number,
): { queue: NoticeQueue; send: Notice[] } {
  const waiting: NoticeQueue = {}
  for (const e of NOTICE_EVENTS) {
    const items = queue[e]
    if (items && on(e)) waiting[e] = items
  }
  for (const n of raised) {
    if (!on(n.event) || n.items.length === 0) continue
    const before = waiting[n.event] ?? []
    waiting[n.event] = LATEST_ONLY.includes(n.event) ? n.items.slice(-1) : [...before, ...n.items.filter((x, i) => !before.includes(x) && n.items.indexOf(x) === i)]
  }
  const send: Notice[] = []
  const rest: NoticeQueue = {}
  for (const e of NOTICE_EVENTS) {
    const items = waiting[e]
    if (!items) continue
    if (now - (last[e] ?? -Infinity) >= NOTICE_GAP_MS) send.push({ event: e, items })
    else rest[e] = items
  }
  return { queue: rest, send }
}

/**
 * Text fit for a terminal's notification sequence, which sends it as given
 * (only a host cleans it): no control characters (an escape, a bell or a
 * newline would end or break the sequence), no bidirectional controls, one
 * line, at most `cells` long. Agents' and runs' names are the model's words.
 */
export function clean(text: string, cells: number): string {
  const line = text
    .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cut(line, cells)
}

/**
 * A notification's text: the event's name (its switch's), then what of it;
 * several merged show their count (`Failure (3): a, b, c`). The label first
 * and a list after it read the same in every language, with no plural forms.
 */
export function noticeText(n: Notice, w: Words): string {
  const label = w.options.labels[NOTICE_OPTION[n.event]]
  const items = n.items.map(x => clean(x, ITEM_CELLS)).filter(x => x !== '')
  if (items.length === 0) return clean(label, TEXT_CELLS)
  const head = items.length > 1 ? `${label} (${items.length})` : label
  return clean(`${head}: ${items.join(', ')}`, TEXT_CELLS)
}

// ── a Windows notification where Claude Code has no channel (plan 14) ──

/** The app id Windows shows a PowerShell script's notifications under: registered on every Windows 10 and 11. */
export const POWERSHELL_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * A text as XML character references, all but letters, digits and spaces:
 * inside PowerShell's single quotes it can then hold no quote of any kind
 * (PowerShell takes ‘ ’ ‚ ‛ for one too), so a name the model wrote never ends
 * the string; the XML parser reads it back as it was. A code point XML cannot
 * hold (a lone surrogate, U+FFFE, U+FFFF) becomes U+FFFD.
 */
export function xmlChars(text: string): string {
  let out = ''
  for (const ch of text) {
    if (/^[A-Za-z0-9 ]$/.test(ch)) {
      out += ch
      continue
    }
    const cp = ch.codePointAt(0) ?? 0xfffd
    const bad = (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff || cp < 0x20
    out += `&#${bad ? 0xfffd : cp};`
  }
  return out
}

/**
 * The script that shows a Windows notification (a toast) of `title` and
 * `text`: Windows PowerShell 5.1 (`powershell.exe`) and its WinRT toast types,
 * no module needed (PowerShell 7 does not load them). It holds no double quote
 * of any kind, so the command line's quoting has nothing to escape in it, and
 * goes as plain `-Command`, as the sounds do (`-EncodedCommand` is what
 * endpoint security watches for). Silent: the mod's own sounds speak. Its
 * `tag` (the event) under the group `forge`: a newer one of a kind replaces the
 * older in the notification center, as a host does by the notification's key.
 */
export function toastScript(title: string, text: string, tag = 'forge'): string {
  const xml = `<toast><visual><binding template=''ToastGeneric''><text>${xmlChars(title)}</text><text>${xmlChars(text)}</text></binding></visual><audio silent=''true''/></toast>`
  const name = tag.replace(/[^A-Za-z0-9-]/g, '').slice(0, 16) || 'forge'
  return [
    "$ErrorActionPreference = 'Stop'",
    '[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${xml}')`,
    '$t = [Windows.UI.Notifications.ToastNotification]::new($x)',
    `$t.Tag = '${name}'`,
    "$t.Group = 'forge'",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${POWERSHELL_APP_ID}').Show($t)`,
  ].join('; ')
}

/**
 * What a test press says came of it (plan 14, so that a toast is never taken
 * for the notification): sent through which channel; sent as a Windows
 * notification, as Claude Code has no channel in this terminal; or nothing
 * shown, and why, with where the channel is set.
 */
export function testSaid(outcome: TreeNotice, w: Words): string {
  const n = w.notices
  if (outcome.kind === 'sent') return n.sent(outcome.channel ?? '')
  if (outcome.kind === 'windows') return `${NAME}: ${n.viaWindows} · ${n.noChannel}`
  const why = outcome.reason === 'no-channel' ? ` · ${n.noChannel} · /config` : outcome.reason === 'disabled' ? ` · ${n.offInClaude} · /config` : ''
  return `${NAME}: ${n.notShown} (${outcome.reason ?? '?'})${why}`
}
