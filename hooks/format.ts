// Formatting helpers: model names and colors, durations, tokens, costs, bars,
// and text measured in terminal cells. Pure functions, no engine access.
import type { Lang } from '../types'
import { NAME, wordsFor } from './words'

export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export type ModelName = {
  family: Family
  /** `Opus 5.5` */
  long: string
  /** `O5.5` */
  short: string
}

const FAMILY_TITLE: Record<Exclude<Family, 'other'>, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
}

/**
 * The theme key a model family is drawn in; theme keys follow the person's
 * light or dark theme. `undefined` draws in the default text color.
 */
export const FAMILY_COLOR: Record<Family, string | undefined> = {
  fable: 'merged',
  opus: 'claude',
  sonnet: 'ide',
  haiku: 'success',
  other: undefined,
}

function named(family: string, major?: string, minor?: string): ModelName {
  const f = family as Exclude<Family, 'other'>
  const version = major === undefined ? '' : minor === undefined ? major : `${major}.${minor}`
  const title = FAMILY_TITLE[f]
  return {
    family: f,
    long: version ? `${title} ${version}` : title,
    short: `${title[0]}${version}`,
  }
}

/** Reads a model id or alias: `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `sonnet`. */
export function modelName(id: string | undefined): ModelName | undefined {
  if (!id) return undefined
  const plain = id.toLowerCase().replace(/\[[^\]]*\]$/, '').trim()
  const modern = /claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(plain)
  if (modern) return named(modern[1]!, modern[2], modern[3])
  const legacy = /claude-(\d+)(?:-(\d))?-(fable|opus|sonnet|haiku)/.exec(plain)
  if (legacy) return named(legacy[3]!, legacy[1], legacy[2])
  const alias = /^(fable|opus|sonnet|haiku)\b/.exec(plain)
  if (alias) return named(alias[1]!)
  return { family: 'other', long: cut(id, 14), short: cut(id, 4) }
}

export function modelColor(id: string | undefined): string | undefined {
  return FAMILY_COLOR[modelName(id)?.family ?? 'other']
}

/** `low`, `med`, `high`, `xhigh`, `max`, or a number as given. */
export function effortName(effort: string | number | undefined): string | undefined {
  if (effort === undefined) return undefined
  if (typeof effort === 'number') return String(effort)
  return effort === 'medium' ? 'med' : effort
}

/** The effort levels the engine names, lowest first. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** A known effort level, or undefined: `xhigh` → `xhigh`, `fast` → undefined. */
export function effortLevel(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const level = value.trim().toLowerCase()
  return (EFFORT_LEVELS as readonly string[]).includes(level) ? level : undefined
}

/**
 * The effort saved for `model` in the `modelSettings` setting, where /effort
 * keeps it per model (`{ "claude-sonnet-5-5": { "effortLevel": "high" } }`);
 * a context suffix on the id (`[1m]`) is looked past.
 */
export function modelEffort(settings: unknown, model: string | undefined): string | undefined {
  if (model === undefined || typeof settings !== 'object' || settings === null) return undefined
  const byModel = settings as Readonly<Record<string, unknown>>
  for (const id of [model, model.replace(/\[[^\]]*\]$/, '')]) {
    const entry = byModel[id]
    if (typeof entry !== 'object' || entry === null) continue
    const level = effortLevel((entry as Readonly<Record<string, unknown>>).effortLevel)
    if (level) return level
  }
  return undefined
}

const EFFORT_SHORT: Readonly<Record<string, string>> = { low: 'lo', medium: 'md', high: 'hi', xhigh: 'xh', max: 'mx' }

/** Two letters for the narrow pane: `lo`, `md`, `hi`, `xh`, `mx`, or a number as given. */
export function effortShort(effort: string | number | undefined): string | undefined {
  if (effort === undefined) return undefined
  if (typeof effort === 'number') return String(effort)
  return EFFORT_SHORT[effort] ?? effort.slice(0, 2)
}

/** `38s`, `1m12s`, `12m`, `1h04m`; in Hungarian `38mp`, `1p12mp`, `12p`, `1ó04p`. */
export function duration(ms: number, lang?: Lang): string {
  const u = wordsFor(lang).units
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}${u.s}`
  const m = Math.floor(s / 60)
  if (m < 10) return `${m}${u.m}${String(s % 60).padStart(2, '0')}${u.s}`
  if (m < 60) return `${m}${u.m}`
  const h = Math.floor(m / 60)
  return `${h}${u.h}${String(m % 60).padStart(2, '0')}${u.m}`
}

/** `4.1s` for an advisor call; `4,1mp` in Hungarian. */
export function seconds(ms: number, lang?: Lang): string {
  const u = wordsFor(lang).units
  return ms < 10_000 ? `${(ms / 1000).toFixed(1).replace('.', u.decimal)}${u.s}` : duration(ms, lang)
}

/** `980`, `21k`, `1.2M`. */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Tokens as token-weather writes them: `734`, `134.4k`, `1.25M`. */
export function tokensFine(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** A window size as token-weather writes it: `200k`, `1M`. */
export function windowSize(n: number): string {
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n % 1000 === 0) return `${n / 1000}k`
  return tokensFine(n)
}

/** `▲ +23.7k`, `▼ -412.0k`: the context's change over a turn. */
export function tokenDelta(n: number): string {
  return `${n < 0 ? '▼ -' : '▲ +'}${tokensFine(Math.abs(n))}`
}

/** Always marked as an estimate: `≈$1.84`; `≈$1.84?` when a price was unknown. */
export function cost(usd: number | undefined, hasUnknownPrice?: boolean): string {
  if (usd === undefined) return hasUnknownPrice ? '≈$?' : ''
  const amount = usd < 100 ? usd.toFixed(2) : String(Math.round(usd))
  return `≈$${amount}${hasUnknownPrice ? '?' : ''}`
}

/** ` 7%`, ` 47%`, `100%`: a whole percentage, right-aligned in four cells; ` ~12%` in five for an estimate. */
export function percent(p: number, estimated = false): string {
  const whole = `${Math.round(Math.min(100, Math.max(0, p)))}%`
  return estimated ? `~${whole}`.padStart(5) : whole.padStart(4)
}

export type Weather = { icon: string; word: string; color: string }

/** The cell a weather sign drawn as a two-cell emoji covers (Windows Terminal): a space of its own. */
export const EMOJI_ROOM = ' '

/**
 * The colors an agent's or a run's name takes in the tree, one row after the
 * other (the user's request of 2026-11-19: no two names alike in a row). None
 * of the state colors' red, nor the frame's and the times' cyans, nor the pulse's bright white.
 */
export const NAME_COLORS = ['magentaBright', 'yellowBright', 'blueBright', 'greenBright', 'white'] as const

/**
 * The context window's weather, the scale the token-weather mod draws in the
 * band above the prompt, so both read alike: clear, cloudy, showers, storm,
 * then red from 90%, where a compaction is near.
 */
export function weatherFor(p: number): Weather {
  // ☀ ☁ ☂ have a color emoji form, which Windows Terminal draws two cells wide
  // over the cell after it; the text-form selector (U+FE0E) did not stop it
  // (the user's live check of 2026-11-19, status.jpg). So a space of their own
  // follows them, which the emoji covers, and the cell after stays clear.
  if (p < 25) return { icon: `☀${EMOJI_ROOM}`, word: 'Clear', color: 'yellow' }
  if (p < 50) return { icon: `☁${EMOJI_ROOM}`, word: 'Cloudy', color: 'cyan' }
  if (p < 75) return { icon: `☂${EMOJI_ROOM}`, word: 'Showers', color: 'blue' }
  if (p < 90) return { icon: '☇', word: 'Storm', color: 'magenta' }
  return { icon: '↯', word: 'Compact soon', color: 'red' }
}

/** The weather's color of a context share. */
export function contextColor(p: number | undefined): string | undefined {
  return p === undefined ? undefined : weatherFor(p).color
}

/** Durations and elapsed times: a theme key (teal in the dark theme), apart from every model's color. */
export const TIME_COLOR = 'planMode'

/** The pane's name, its top row. */
export const TITLE_TEXT = NAME
/** The title's color: the cyan of the icon's tree. */
export const TITLE_COLOR = 'cyan'

/** `main` and the line from it to its agents: a light cyan, the icon's tree lit. */
export const TRUNK_COLOR = 'cyanBright'

/** The light that runs down the trunk while things work. */
export const PULSE_COLOR = 'whiteBright'

const BRIGHTER: Readonly<Record<string, string>> = {
  yellow: 'yellowBright',
  cyan: 'cyanBright',
  blue: 'blueBright',
  magenta: 'magentaBright',
  red: 'redBright',
  green: 'greenBright',
  // the limit bars' traffic-light theme keys
  success: 'greenBright',
  warning: 'yellowBright',
  error: 'redBright',
}

/** The shade a little lighter than a bar's color, for the cell that runs along it. */
export function brighter(color: string | undefined): string {
  return (color && BRIGHTER[color]) || 'whiteBright'
}

/** Where a limit bar turns yellow and red, in percent: the `limitWarnAt` and `limitAlertAt` options. */
export type LimitThresholds = { warn: number; alert: number }

/** The thresholds the options start from: yellow from 50%, red from 80%. */
/** Where a limit's bar turns yellow and red, and the HUD's lamp CAUTION and CRITICAL: 60% and 90% (the user's defaults of 2026-11-20; options). */
export const LIMIT_THRESHOLDS: LimitThresholds = { warn: 60, alert: 90 }

/** A rate limit's share as a traffic light: green, yellow from `warn` (50%), red from `alert` (80%). */
export function limitColor(p: number, t: LimitThresholds = LIMIT_THRESHOLDS): string {
  if (p >= t.alert) return 'error'
  if (p >= t.warn) return 'warning'
  return 'success'
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar of `cells` cells at 1/8-cell resolution: the filled part and the rest. */
export function bar(fraction: number, cells: number): { fill: string; rest: string } {
  const f = Math.min(1, Math.max(0, fraction)) * cells
  let full = Math.floor(f)
  let part = Math.round((f - full) * 8)
  if (part === 8) {
    full += 1
    part = 0
  }
  const fill = '█'.repeat(full) + (full < cells ? EIGHTHS[part]! : '')
  return { fill, rest: '░'.repeat(Math.max(0, cells - fill.length)) }
}

const SPARK = '▁▂▃▄▅▆▇█'

/** The last `cells` samples as a sparkline, padded on the left. */
export function spark(samples: readonly number[] | undefined, cells: number): string {
  const last = (samples ?? []).slice(-cells)
  if (last.length === 0) return ' '.repeat(cells)
  const lo = Math.min(...last)
  const hi = Math.max(...last)
  const line = last
    .map(v => (hi === lo ? SPARK[0] : SPARK[Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 7.999))]))
    .join('')
  return line.padStart(cells)
}

/** `14:03`, in the machine's local time. */
export function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `45m`, `2h12m`, `2d4h`: how long until a moment; `now` once it has come. Hungarian: `45p`, `2ó12p`, `2n4ó`, `most`. */
export function until(ms: number, lang?: Lang): string {
  const w = wordsFor(lang)
  const u = w.units
  if (ms <= 0) return w.now
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m}${u.m}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}${u.h}${String(m % 60).padStart(2, '0')}${u.m}`
  return `${Math.floor(h / 24)}${u.d}${h % 24}${u.h}`
}

/**
 * When a moment falls, in local time: `16:24` today, `Fri 18:12` within six
 * days (`long`: `Friday 18:12`), `Nov 26 09:00` later; in Hungarian `P 18:12`
 * (`péntek 18:12`), `nov. 26. 09:00`.
 */
export function at(ms: number, now: number, lang?: Lang, long = false): string {
  const w = wordsFor(lang)
  const when = new Date(ms)
  if (when.toDateString() === new Date(now).toDateString()) return clock(ms)
  if (ms - now < 6 * 86_400_000) return `${(long ? w.daysLong : w.days)[when.getDay()]} ${clock(ms)}`
  return `${w.date(when.getMonth(), when.getDate())} ${clock(ms)}`
}

/** `12s ago`, `2m ago` (minutes drop their seconds); `2p ezelőtt` in Hungarian. */
export function ago(ms: number, lang?: Lang): string {
  const w = wordsFor(lang)
  const s = Math.max(0, Math.floor(ms / 1000))
  return w.ago(s >= 60 && s < 600 ? `${Math.floor(s / 60)}${w.units.m}` : duration(ms, lang))
}

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
/**
 * Signs a terminal draws as a two-cell emoji by default (✅ ❌ ⚡ ⭐ ⌛ 🀄 🆕),
 * as Claude Code's own measure counts them (Bun.stringWidth). The pane's own
 * signs are none of these (✓ ✗ ✎ ▣ ◆ ● ‖ ■ ○ ◌ ⬢ ↯ ☇ ☀ ☁ ☂ ▾ ► ▸), checked
 * in the mod's runtime (the review of 2026-11-20).
 */
const EMOJI = /\p{Emoji_Presentation}/u
/** What may follow a joiner and still be drawn as one emoji with the sign before. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
/** Nothing but plain ASCII: one cell a character, the common case measured at once. */
const ASCII = /^[\x20-\x7e]*$/

function regional(code: number | undefined): boolean {
  return code !== undefined && code >= 0x1f1e6 && code <= 0x1f1ff
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0
  // combining marks: part of the sign before
  if ((code >= 0x300 && code <= 0x36f) || (code >= 0x20d0 && code <= 0x20ff)) return 0
  // Nothing below U+1100 is wide; box drawing, blocks and braille are not either (the pane's bars, frames and spinner).
  if (code < 0x1100 || (code >= 0x2500 && code <= 0x25fc) || (code >= 0x2800 && code <= 0x28ff)) return 1
  // variation selectors (the text or emoji form of the sign before) take no cell of their own
  if (code >= 0xfe00 && code <= 0xfe0f) return 0
  // zero-width spaces and joiners
  if ((code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff) return 0
  return WIDE.test(ch) || EMOJI.test(ch) ? 2 : 1
}

/**
 * A text's signs as the terminal draws them, each with what joins it: an
 * emoji's form selector, a skin tone, a joiner and the emoji after it, the
 * second half of a flag, a combining mark.
 */
export function clusters(text: string): string[] {
  const out: string[] = []
  let joiner = false
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const last = out[out.length - 1]
    const attaches =
      last !== undefined &&
      ((joiner && PICTOGRAPHIC.test(ch)) ||
        code === 0x200d ||
        (code >= 0xfe00 && code <= 0xfe0f) ||
        (code >= 0x1f3fb && code <= 0x1f3ff) ||
        (code >= 0x300 && code <= 0x36f) ||
        (code >= 0x20d0 && code <= 0x20ff) ||
        (regional(code) && regional(last.codePointAt(0)) && [...last].length === 1))
    joiner = code === 0x200d
    if (attaches) out[out.length - 1] = last + ch
    else out.push(ch)
  }
  return out
}

/** The cells one cluster takes: its first sign's, two for a sign shown in its emoji form (`⚠️`). */
function clusterWidth(c: string): number {
  const first = charWidth(String.fromCodePoint(c.codePointAt(0) ?? 0))
  return first === 1 && c.includes('️') ? 2 : first
}

/**
 * How many terminal cells a text takes, as Claude Code measures it: wide
 * scripts and emoji two (the review of 2026-11-20: a ✅ counted as one made a
 * row wider than the pane), a joined emoji or a flag as one sign. The same
 * count as `clusters` and their widths, in one pass: it runs for every part of
 * every row.
 */
export function width(text: string): number {
  if (ASCII.test(text)) return text.length
  let w = 0
  // the cells the last sign took; a joiner came; the first half of a flag stands alone
  let last = 0
  let joiner = false
  let half = false
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0xfe0f) {
      // its emoji form: two cells
      if (last === 1) {
        w += 1
        last = 2
      }
      continue
    }
    if (code === 0x200d) {
      joiner = true
      continue
    }
    if (joiner) {
      joiner = false
      if (code >= 0x80 && PICTOGRAPHIC.test(ch)) continue
    }
    if ((code >= 0x1f3fb && code <= 0x1f3ff) || (code >= 0xfe00 && code <= 0xfe0e)) continue
    if (regional(code)) {
      half = !half
      if (!half) continue
      w += 2
      last = 2
      continue
    }
    half = false
    const cw = charWidth(ch)
    w += cw
    if (cw > 0) last = cw
  }
  return w
}

/** A text padded on the left to `cells` cells, by cells, not characters: a time in Japanese is two cells a sign. */
export function padStartCells(text: string, cells: number): string {
  return ' '.repeat(Math.max(0, cells - width(text))) + text
}

/** A text padded on the right to `cells` cells, by cells. */
export function padEndCells(text: string, cells: number): string {
  return text + ' '.repeat(Math.max(0, cells - width(text)))
}

/** Cuts a text to `cells`, ending it with `…` when anything was left out. */
export function cut(text: string, cells: number): string {
  if (cells <= 0) return ''
  if (width(text) <= cells) return text
  let out = ''
  let w = 0
  for (const c of clusters(text)) {
    const cw = clusterWidth(c)
    if (w + cw > cells - 1) break
    out += c
    w += cw
  }
  return `${out}…`
}

/** One line: whitespace runs and line breaks become single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

function host(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** What a tool call does, in a few words: `Grep src/auth/**`, `Bash npm test`. */
export function activity(tool: string, input: Readonly<Record<string, unknown>>): string {
  const text = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' ? oneLine(value) : ''
  }
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return `${tool} ${text('command')}`.trim()
    case 'Read':
    case 'Edit':
    case 'Write':
      return `${tool} ${shortPath(text('file_path'))}`.trim()
    case 'NotebookEdit':
      return `${tool} ${shortPath(text('notebook_path'))}`.trim()
    case 'Grep':
    case 'Glob':
      return `${tool} ${text('pattern')}`.trim()
    case 'WebFetch':
      return `WebFetch ${host(text('url'))}`.trim()
    case 'WebSearch':
      return `WebSearch ${text('query')}`.trim()
    case 'Agent':
    case 'Task':
      return `Agent ${text('description')}`.trim()
    case 'Skill':
      return `Skill ${text('skill')}`.trim()
    default: {
      if (tool.startsWith('mcp__')) {
        const [, server = '', name = ''] = tool.split('__')
        return `${server}·${name}`
      }
      return tool
    }
  }
}
