/**
 * The Forge HUD (plan 08, the user's approval of 2026-11-19): a sci-fi skin
 * over the classic rows. layout.ts builds the rows as ever and tags what each
 * is (`RowTags`, `Seg.part`); this redraws the tagged parts its own way and
 * leaves every value, row and button where it was:
 * - the title as a bar: `◢◤ AGENT TREE // FORGE ━━━ ◉ NOMINAL ▾en`, its lamp
 *   lit by the context and the limits;
 * - rails where the classic look has an empty row or a separator, named for
 *   the group they open (`┌ CORE ┄┄┐`), the tree's telling the agents at work,
 *   the log's the time;
 * - LED bars (`▌`), the main trunk heavy (`┃ ┣━ ┗━`), the core `⬢` at its root,
 *   panels in corner brackets with the chosen value lit as a key;
 * - on a dark theme its own neon palette and a navy plate under the header; on
 *   a light or an ANSI one the named colors.
 * Every row keeps its width. No engine access: tested alone.
 */
import type { TreeAgent, TreeState, TreeUi } from '../types'
import { FAMILY_COLOR, LIMIT_THRESHOLDS, NAME_COLORS, PULSE_COLOR, TIME_COLOR, TRUNK_COLOR, brighter, cut, effortName, modelColor, modelName, width } from './format'
import type { LimitThresholds } from './format'
import type { LayoutOptions, Mode, Rail, Row, Seg, ThemeKind } from './layout'
import { runOf, runTally } from './model'
import { isCritical } from './sounds'
import type { Words } from './words'

/** What the skin needs besides the rows. */
export type SkinContext = {
  s: TreeState
  ui: TreeUi
  o: LayoutOptions
  w: Words
  cols: number
  mode: Mode
}

type Palette = {
  neon: string
  neonHi: string
  conduit: string
  conduitIn: string
  rail: string
  railLabel: string
  core: string
  ink: string
  count?: string
  plate?: string
  /** Named or hex: a dark theme mixes tints, the others cannot. */
  hex: boolean
}

/** A dark theme: the logo's neon cyan and violet, deep-teal rails, a navy plate. */
const DARK: Palette = {
  neon: '#2EE6F2',
  neonHi: '#CFFBFF',
  conduit: '#24D3E4',
  conduitIn: '#1FA6BA',
  rail: '#1F5E6B',
  railLabel: '#62DCEB',
  core: '#8573FA',
  ink: '#04121A',
  count: '#A9C7D6',
  plate: '#0B1828',
  hex: true,
}

/** A light or an ANSI theme: the named colors the classic look uses, nothing mixed. */
const NAMED: Palette = {
  neon: 'cyan',
  neonHi: 'cyan',
  conduit: TRUNK_COLOR,
  conduitIn: 'cyan',
  rail: 'cyan',
  railLabel: 'cyan',
  core: 'merged',
  ink: 'black',
  hex: false,
}

function paletteOf(theme: ThemeKind | undefined): Palette {
  return theme === 'light' || theme === 'ansi' ? NAMED : DARK
}

/** The bars' colors made neon on a dark theme: the same hues as the token-weather scale and the limits' traffic light. */
const NEON_OF: Readonly<Record<string, string>> = {
  yellow: '#FFD23F',
  cyan: '#2EE6F2',
  cyanBright: '#2EE6F2',
  blue: '#4D8DFF',
  magenta: '#E055FF',
  red: '#FF4D6D',
  success: '#3DDC84',
  warning: '#FFC93C',
  error: '#FF4D6D',
}

/** The names' colors made neon on a dark theme, in the classic order. */
const NAME_NEON: Readonly<Record<(typeof NAME_COLORS)[number], string>> = {
  magentaBright: '#FF6AD5',
  yellowBright: '#FFD866',
  blueBright: '#6AB0FF',
  greenBright: '#7CFFB2',
  white: '#E6E8FF',
}

/** The terminal's black, which a tint fades toward. */
const GROUND = '#0C0C0C'

/** Two `#rrggbb` colors mixed: `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `#${((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`
}

const isHex = (c: string | undefined): c is string => c !== undefined && /^#[0-9a-f]{6}$/i.test(c)

/** Capitals in the pane's language: the Turkish dotted İ, the German SS; Greek capitals without their accents. */
export function upper(text: string, lang: string | undefined): string {
  const locale = lang === 'sr' ? 'sr-Latn' : (lang ?? 'en')
  let out: string
  try {
    out = text.toLocaleUpperCase(locale)
  } catch {
    out = text.toUpperCase()
  }
  return lang === 'el' ? out.normalize('NFD').replace(/[́̈]/g, '').normalize('NFC') : out
}

/** The status lamp: critical at a limit's red mark or a context of 90%, caution at a yellow mark or 75%. */
export type Lamp = 'nominal' | 'caution' | 'critical'

export function lampOf(s: TreeState, thresholds: LimitThresholds = LIMIT_THRESHOLDS): Lamp {
  if (isCritical(s, thresholds)) return 'critical'
  const ctx = s.main.contextPercent
  if (ctx !== undefined && !s.main.contextEstimated && ctx >= 75) return 'caution'
  if ((s.main.limits ?? []).some(l => l.percent >= thresholds.warn)) return 'caution'
  return 'nominal'
}

const LAMP_COLOR: Readonly<Record<Lamp, string>> = { nominal: 'success', caution: 'warning', critical: 'error' }
/** The lamp's colors on a dark theme: the same three, mixable, so the lamp can breathe. */
const LAMP_HEX: Readonly<Record<Lamp, string>> = { nominal: '#3DDC84', caution: '#FFC93C', critical: '#FF4D6D' }
/** The lamp's word in the narrow view: the shape stays `◉`, so the word tells the state (color is never the only sign). */
const LAMP_MARK: Readonly<Record<Lamp, string>> = { nominal: 'OK', caution: '!', critical: '!!' }

function cells(segs: readonly Seg[]): number {
  return segs.reduce((n, s) => n + width(s.text), 0)
}

function rowSegs(row: Row): Seg[] | undefined {
  return row.kind === 'keys' ? undefined : row.segs
}

function withSegs(row: Row, segs: Seg[]): Row {
  return row.kind === 'keys' ? row : ({ ...row, segs } as Row)
}

/** `segs` made `cols` wide: spaces taken from the widest run of them, or added at the end. */
function fitTo(segs: Seg[], cols: number): Seg[] {
  let over = cells(segs) - cols
  const out = segs.map(s => ({ ...s }))
  while (over > 0) {
    let best = -1
    for (let i = 0; i < out.length; i++) {
      const t = out[i]!.text
      if (/^ +$/.test(t) && t.length > 1 && (best < 0 || t.length > out[best]!.text.length)) best = i
    }
    if (best < 0) break
    const take = Math.min(over, out[best]!.text.length - 1)
    out[best] = { ...out[best]!, text: out[best]!.text.slice(take) }
    over -= take
  }
  if (over > 0) {
    // No room left in the spaces: the last part cut.
    for (let i = out.length - 1; i >= 0 && over > 0; i--) {
      const w = width(out[i]!.text)
      const keep = Math.max(0, w - over)
      over -= w - keep
      out[i] = { ...out[i]!, text: keep > 0 ? cut(out[i]!.text, keep) : '' }
    }
  }
  return out.filter(s => s.text.length > 0)
}

// ── the title bar ───────────────────────────────────────────────────────

function titleRow(row: Row, k: SkinContext, p: Palette): Row {
  const segs = rowSegs(row) ?? []
  const signs = segs.filter(s => s.press !== undefined)
  const title = segs.find(s => s.part === 'title')
  const name = upper(title?.text ?? 'AGENT TREE // FORGE', 'en')
  const lamp = lampOf(k.s, k.o.limits)
  const word = k.mode === 'narrow' ? LAMP_MARK[lamp] : upper(k.w.hud[lamp], k.w.lang)
  const lit = p.hex ? LAMP_HEX[lamp] : LAMP_COLOR[lamp]
  const build = (emblem: boolean, withWord: boolean): Seg[] | undefined => {
    const left: Seg[] = [...(emblem ? [{ text: '◢◤', color: p.neon }, { text: ' ' }] : []), { text: name, color: p.neon, bold: true }]
    const right: Seg[] = [
      { text: ' ' },
      { text: '◉', color: lit, part: 'lamp' },
      ...(withWord ? [{ text: ' ' }, { text: word, color: lit, bold: true, part: 'lamp' as const }] : []),
      ...(signs.length > 0 ? [{ text: ' ' }, ...signs] : []),
    ]
    const rule = k.cols - cells(left) - 1 - cells(right)
    if (rule < 2) return undefined
    return [...left, { text: ' ' }, { text: '━'.repeat(rule), color: p.rail, part: 'rule' }, ...right]
  }
  const out = build(true, true) ?? build(true, false) ?? build(false, false) ?? segs
  return withSegs(row, out)
}

// ── rails ───────────────────────────────────────────────────────────────

/** The clock on the log's rail: with seconds while the pane moves (it keeps redrawing for it), else hours and minutes. */
function clockOf(at: number, seconds: boolean): string {
  const d = new Date(at)
  const parts = seconds ? [d.getHours(), d.getMinutes(), d.getSeconds()] : [d.getHours(), d.getMinutes()]
  return parts.map(n => String(n).padStart(2, '0')).join(':')
}

function railRow(row: Row, rail: Rail, k: SkinContext, p: Palette): Row {
  const open = rail.close ? '└' : '┌'
  const end = rail.close ? '┘' : '┐'
  const name = rail.label === 'log' ? k.w.keys.log : rail.label ? k.w.hud[rail.label] : undefined
  const label: Seg[] = name ? [{ text: ' ' }, { text: upper(name, k.w.lang), color: p.railLabel }, { text: ' ' }] : []
  let right: Seg[] = []
  if (rail.info === 'agents') {
    const count = (states: readonly string[]): number => k.s.agents.filter(a => states.includes(a.state)).length
    const running = count(['running', 'starting'])
    const waiting = count(['waiting'])
    const parts: Seg[][] = []
    if (running > 0) parts.push([{ text: k.w.glance.running(running), color: p.count }])
    if (waiting > 0) parts.push([{ text: k.w.glance.waiting(waiting), color: 'warning' }])
    right = parts.flatMap((x, i) => (i > 0 ? [{ text: ' · ', color: p.rail }, ...x] : x))
  }
  // Its seconds tick only while the pane redraws on its own: a live cell keeps an idle pane redrawing.
  if (rail.info === 'clock') right = [{ text: clockOf(k.o.now, k.o.animate), color: TIME_COLOR, ...(k.o.animate ? { live: true as const } : {}) }]
  const build = (withLabel: boolean, withRight: boolean): Seg[] | undefined => {
    const l = withLabel ? label : []
    const r = withRight && right.length > 0 ? [{ text: ' ' }, ...right, { text: ' ' }] : []
    const fill = k.cols - 2 - cells(l) - cells(r)
    if (fill < 1) return undefined
    return [{ text: open, color: p.rail, part: 'rail' }, ...l, { text: '┄'.repeat(fill), color: p.rail, part: 'rail' }, ...r, { text: end, color: p.rail, part: 'rail' }]
  }
  const segs = build(true, true) ?? build(true, false) ?? build(false, false) ?? [{ text: '┄'.repeat(k.cols), color: p.rail, part: 'rail' }]
  return { kind: 'text', segs, role: 'rail', rail }
}

// ── bars ────────────────────────────────────────────────────────────────

/** A row's bars as LED segments: lit `▌` in the bar's color (neon on a dark theme), unlit in its dark tint, or `▏` where no tint can be mixed. */
function bars(segs: readonly Seg[], k: SkinContext, p: Palette): Seg[] {
  const out: Seg[] = []
  let i = 0
  while (i < segs.length) {
    const seg = segs[i]!
    if (seg.part !== 'bar' && seg.part !== 'barRest') {
      out.push(seg)
      i++
      continue
    }
    let j = i
    while (j < segs.length && (segs[j]!.part === 'bar' || segs[j]!.part === 'barRest')) j++
    const run = segs.slice(i, j)
    const n = cells(run)
    const fill = run[0]!.fill ?? 0
    const lit = fill > 0 ? Math.max(1, Math.min(n, Math.round(fill * n))) : 0
    // The bar's color: the one most of its lit parts have (one may be the running light's).
    const tally = new Map<string, number>()
    for (const r of run) if (r.part === 'bar' && r.color && !r.live) tally.set(r.color, (tally.get(r.color) ?? 0) + width(r.text))
    const base = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? run.find(r => r.color)?.color ?? 'cyan'
    const color = p.hex ? (NEON_OF[base] ?? base) : base
    const moving = k.o.animate && lit >= 3 ? k.o.frame % lit : -1
    // The alarm (plan 08, F2): a bar in red (the context's ↯, a limit at its red mark) pulses, slowly.
    const alarm = k.o.animate && (base === 'red' || base === 'error')
    const wave = alarm ? (1 - Math.cos((k.o.frame / 16) * Math.PI * 2)) / 2 : 0
    const steady = alarm ? (isHex(color) ? mix(color, '#FFFFFF', 0.45 * wave) : wave > 0.5 ? brighter(color) : color) : color
    for (let c = 0; c < lit; c++) {
      if (c === moving) out.push({ text: '▌', color: isHex(color) ? mix(color, '#FFFFFF', 0.55) : brighter(color), live: true })
      else out.push({ text: '▌', color: steady, ...(alarm ? { live: true as const } : {}) })
    }
    if (n > lit) out.push(p.hex && isHex(color) ? { text: '▌'.repeat(n - lit), color: mix(color, GROUND, 0.74) } : { text: '▏'.repeat(n - lit), color })
    i = j
  }
  return out
}

// ── the tree ────────────────────────────────────────────────────────────

const HEAVY: Readonly<Record<string, string>> = { '│': '┃', '├': '┣', '└': '┗' }

/** The tree's lines: the outermost trunk heavy, the others light, all in the conduit colors; the pulse's head white. */
function guides(segs: readonly Seg[], p: Palette): Seg[] {
  const out: Seg[] = []
  let col = 0
  for (const seg of segs) {
    if (seg.part !== 'guide') {
      // A run's ▣: a node of the conduits, in their color (a failed run's stays red).
      if (seg.text === '▣' && seg.color === TRUNK_COLOR) out.push({ ...seg, color: p.conduit })
      else out.push(seg)
      col += width(seg.text)
      continue
    }
    for (const ch of seg.text) {
      const trunk = col <= 1
      let glyph = ch
      if (col === 0 && HEAVY[ch]) glyph = HEAVY[ch]!
      if (col === 1 && ch === '─' && (out[out.length - 1]?.text === '┣' || out[out.length - 1]?.text === '┗')) glyph = '━'
      // The classic pulse's cell too: the HUD's own comet runs on these lines (motion).
      const { bold: _bold, ...rest } = seg
      out.push({ ...rest, text: glyph, color: trunk ? p.conduit : p.conduitIn })
      col += 1
    }
  }
  return merge(out)
}

/** Neighbouring parts of one look and one press joined again. */
function merge(segs: readonly Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (
      last &&
      last.color === s.color &&
      last.bold === s.bold &&
      last.dim === s.dim &&
      last.bg === s.bg &&
      last.live === s.live &&
      last.key === s.key &&
      last.press === s.press &&
      last.part === s.part &&
      last.href === s.href &&
      last.part !== 'bar'
    )
      out[out.length - 1] = { ...last, text: last.text + s.text }
    else out.push({ ...s })
  }
  return out
}

/** The main row: the core `⬢` before `main`, the room for it taken from the gap (else from the prompt). */
function mainRow(row: Row, k: SkinContext, p: Palette): Row {
  const segs = (rowSegs(row) ?? []).map(s => ({ ...s }))
  const at = segs.findIndex(s => s.text === 'main')
  if (at < 0) return row
  segs[at] = { ...segs[at]!, color: p.neon }
  segs.splice(at, 0, { text: '⬢', color: p.core, part: 'core' }, { text: ' ' })
  // one space before the prompt's quote, as the narrow view has
  const quote = segs.findIndex(s => s.text === '  “')
  if (quote >= 0) segs[quote] = { ...segs[quote]!, text: ' “' }
  let over = cells(segs) - k.cols
  // the gap between the prompt and the time first, keeping a space
  for (let i = 0; i < segs.length && over > 0; i++) {
    const t = segs[i]!.text
    if (/^ {3,}$/.test(t)) {
      const take = Math.min(over, t.length - 1)
      segs[i] = { ...segs[i]!, text: t.slice(take) }
      over -= take
    }
  }
  const prompt = segs.findIndex(s => s.part === 'prompt')
  if (over > 0 && prompt >= 0) {
    // Cut again, its ellipsis kept, no space left before it.
    const t = segs[prompt]!.text
    const room = Math.max(1, width(t) - over)
    const short = cut(t, room).replace(/\s+…$/, '…')
    segs[prompt] = { ...segs[prompt]!, text: short }
    // what the cut gave back goes to the gap before the time
    const back = room - width(short)
    const gap = segs.findIndex((s, i) => i > prompt && /^ +$/.test(s.text))
    if (back > 0 && gap >= 0) segs[gap] = { ...segs[gap]!, text: segs[gap]!.text + ' '.repeat(back) }
  }
  return withSegs(row, fitTo(segs, k.cols))
}

// ── panels ──────────────────────────────────────────────────────────────

function frameTop(row: Row, k: SkinContext, p: Palette): Row {
  const t = (rowSegs(row) ?? []).find(s => s.part === 'title')?.text ?? ''
  // A message's title keeps the agent's name as it is; the others go in capitals.
  const title = t.startsWith('✎') ? t : upper(t, k.w.lang)
  const room = Math.max(1, k.cols - 8)
  const name = cut(title, room)
  const gap = Math.max(1, k.cols - 6 - 1 - width(name))
  return withSegs(row, [
    { text: '┏━━', color: p.neon, part: 'frame' },
    { text: ' ' },
    { text: name, color: p.neonHi, bold: true },
    { text: ' '.repeat(gap) },
    { text: '━━┓', color: p.neon, part: 'frame' },
  ])
}

function frameBottom(row: Row, k: SkinContext, p: Palette): Row {
  const foot = (rowSegs(row) ?? []).find(s => s.part === 'title')?.text
  const said = foot ? cut(upper(foot, k.w.lang), Math.max(1, k.cols - 8)) : ''
  const gap = k.cols - 6 - (said ? 1 + width(said) : 0)
  return withSegs(row, [
    { text: '┗━━', color: p.neon, part: 'frame' },
    ...(said ? [{ text: ' ' }, { text: said, color: p.neon }] : []),
    { text: ' '.repeat(Math.max(1, gap)) },
    { text: '━━┛', color: p.neon, part: 'frame' },
  ])
}

/** A panel's line: open sides, the chosen value lit as a key with a space of light either side. */
function frameSide(row: Row, p: Palette): Row {
  const segs = (rowSegs(row) ?? []).map(s => ({ ...s }))
  if (segs[0]?.text === '│ ') segs[0] = { text: '  ' }
  const last = segs.length - 1
  if (segs[last]?.text === ' │') segs[last] = { text: '  ' }
  const out: Seg[] = []
  const lit = (s: Seg): Seg => ({ ...s, color: p.ink, bg: p.neon, bold: true })
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    if (s.part !== 'picked') {
      if (s.text === '×') out.push({ ...s, color: p.neon, bold: true })
      else out.push(s)
      continue
    }
    // a space of light before it, taken from the spaces there
    const before = out[out.length - 1]
    if (before && /^ +$/.test(before.text)) {
      out[out.length - 1] = { ...before, text: before.text.slice(1) }
      out.push({ text: ' ', bg: p.neon })
    }
    out.push(lit(s))
    const after = segs[i + 1]
    if (after && /^ +$/.test(after.text) && after.text.length > 1) {
      out.push({ text: ' ', bg: p.neon })
      segs[i + 1] = { ...after, text: after.text.slice(1) }
    }
  }
  return withSegs(row, out.filter(s => s.text.length > 0))
}

// ── motion (plan 08, F2 and F3) ─────────────────────────────────────────

/**
 * How long an event's effect lasts (ms): a new log row typed in, a new agent's
 * name, a finished one's flash, a failed one's glitch, the advisor's flash, a
 * panel unfolding.
 */
export const EFFECT_MS = { type: 900, spawn: 800, done: 700, glitch: 800, advisor: 700, unfold: 420 } as const
/** The boot sequence (F3): its lines until `lines`, the bar until `bar`, the pane drawn in until `reveal`. */
export const BOOT_MS = { lines: 1300, bar: 1700, reveal: 2300 } as const
/** The empty tree's radar (F3): cells wide, rows tall. */
export const RADAR = { w: 14, h: 6 } as const
/** Frames a comet rests at the bottom of its line before it leaves its source again (as the classic pulse). */
const COMET_REST = 3
/** Frames between two sweeps of the title's rule, and between two scan lines down the pane. */
const SWEEP_EVERY = 40
const SCAN_EVERY = 56
const GLITCH = '▓▒░█▚▞▙▟▛▜'
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** One character of a row and its look: rows are cut into these, changed, and joined again. */
type Cell = Seg
type Line = { row: Row; cells?: Cell[] }

function split(segs: readonly Seg[]): Cell[] {
  const out: Cell[] = []
  for (const s of segs) for (const ch of Array.from(s.text)) out.push({ ...s, text: ch })
  return out
}

/** The column each cell starts at. */
function columns(cells: readonly Cell[]): number[] {
  const out: number[] = []
  let c = 0
  for (const x of cells) {
    out.push(c)
    c += width(x.text)
  }
  return out
}

/** The flash of an effect: white on a dark ground, blue on a light one (white would not show there). */
function flash(k: SkinContext, p: Palette): string {
  return p.hex ? '#FFFFFF' : k.o.theme === 'light' ? 'blue' : 'whiteBright'
}

/** A color a shade toward white: mixed on a dark theme, the bright named one otherwise (blue on a light ground). */
function lighter(color: string | undefined, t: number, p: Palette, k?: SkinContext): string {
  if (isHex(color)) return mix(color, '#FFFFFF', t)
  if (k?.o.theme === 'light') return 'blue'
  return t > 0.3 ? (p.hex ? '#FFFFFF' : 'whiteBright') : brighter(color)
}

/** The colors of a comet: its head, then its tail (on a light ground a blue head, white would not show). */
function cometColors(p: Palette, k?: SkinContext): [string, string, string] {
  if (p.hex) return ['#FFFFFF', '#9FF6FF', '#5FE9F7']
  return k?.o.theme === 'light' ? ['blue', 'cyan', 'cyan'] : ['whiteBright', 'cyanBright', 'cyan']
}

/**
 * A comet down every line of the tree (the user's rule: every line carries the
 * pulse, idle too): a white head and a two-cell tail, a row a frame, turning
 * onto each branch it passes; the line's source (the core, a run's `▣`, an
 * agent's sign) lights as it sends one.
 */
function comets(lines: Line[], k: SkinContext, p: Palette): void {
  const vertical = '┃┣┗│├└'
  const at = (i: number, col: number): number => {
    const l = lines[i]
    if (!l?.cells) return -1
    const cols = columns(l.cells)
    return cols.indexOf(col)
  }
  // the columns a line can run in: those of the guides
  const used = new Set<number>()
  lines.forEach(l => {
    if (!l.cells) return
    const cols = columns(l.cells)
    l.cells.forEach((c, j) => {
      if (c.part === 'guide' && vertical.includes(c.text)) used.add(cols[j]!)
    })
  })
  const [head, tail1, tail2] = cometColors(p, k)
  for (const col of [...used].sort((a, b) => a - b)) {
    let start = -1
    for (let i = 0; i <= lines.length; i++) {
      const j = i < lines.length ? at(i, col) : -1
      const on = j >= 0 && lines[i]!.cells![j]!.part === 'guide' && vertical.includes(lines[i]!.cells![j]!.text)
      if (on && start < 0) start = i
      if (on || start < 0) continue
      // a line from `start` to `i - 1`; its source the cell above, in its column
      const path: Array<{ row: number; cell: number; source?: true }> = []
      const src = at(start - 1, col)
      if (src >= 0 && lines[start - 1]!.cells![src]!.text.trim() !== '') path.push({ row: start - 1, cell: src, source: true })
      for (let r = start; r < i; r++) path.push({ row: r, cell: at(r, col) })
      const step = k.o.frame % (path.length + COMET_REST)
      const paint = (back: number, color: string): void => {
        const n = step - back
        if (n < 0 || n >= path.length) return
        const spot = path[n]!
        const cells = lines[spot.row]!.cells!
        const cell = cells[spot.cell]!
        if (spot.source) {
          if (back === 0) cells[spot.cell] = { ...cell, color: head, bold: true, live: true }
          return
        }
        cells[spot.cell] = { ...cell, color, ...(back === 0 ? { bold: true } : {}), live: true }
        // it turns onto the branch it passes
        if (back < 2 && '┣┗├└'.includes(cell.text)) {
          const next = cells[spot.cell + 1]
          if (next && '━─'.includes(next.text)) cells[spot.cell + 1] = { ...next, color, live: true }
        }
      }
      paint(2, tail2)
      paint(1, tail1)
      paint(0, head)
      start = -1
    }
  }
}

/** The title: a light sweeps its rule left to right every few seconds; the lamp breathes, and blinks when critical. */
function titleMotion(line: Line, k: SkinContext, p: Palette): void {
  const cells = line.cells
  if (!cells) return
  const f = k.o.frame
  const rule = cells.map((c, j) => (c.part === 'rule' ? j : -1)).filter(j => j >= 0)
  const pos = (f % SWEEP_EVERY) - 4
  const shades = [0.25, 0.55, 0.9, 0.5]
  rule.forEach((j, n) => {
    const d = n - pos
    const t = d >= 0 && d < shades.length ? shades[d]! : 0
    cells[j] = { ...cells[j]!, color: t > 0 ? (p.hex ? mix(p.rail, p.neonHi, t) : t > 0.5 ? 'cyanBright' : p.rail) : cells[j]!.color, live: true }
  })
  const lamp = lampOf(k.s, k.o.limits)
  const breath = (1 - Math.cos((f / 16) * Math.PI * 2)) / 2
  cells.forEach((c, j) => {
    if (c.part !== 'lamp') return
    let color = c.color
    if (lamp === 'critical') color = Math.floor(f / 4) % 2 === 0 ? c.color : p.hex ? '#FFFFFF' : 'redBright'
    else if (p.hex && isHex(c.color)) color = mix(c.color, '#FFFFFF', 0.35 * breath)
    cells[j] = { ...c, color, live: true }
  })
}

/** The core beats while the main session works. */
function coreMotion(line: Line, k: SkinContext, p: Palette): void {
  if (!line.cells || !k.s.main.isBusy) return
  const t = (1 - Math.cos((k.o.frame / 8) * Math.PI * 2)) / 2
  line.cells.forEach((c, j) => {
    if (c.part !== 'core') return
    const color = p.hex && isHex(c.color) ? mix(c.color, '#D2C9FF', t) : t > 0.5 ? 'magentaBright' : c.color
    line.cells![j] = { ...c, color, live: true }
  })
}

/** Cells from `from` on hidden (blank, as wide), a cursor at the edge. */
function typeIn(cells: Cell[], from: number, to: number, shown: number, p: Palette): void {
  for (let j = from; j < to; j++) {
    const c = cells[j]!
    if (j < shown) continue
    const blank = ' '.repeat(width(c.text))
    cells[j] = j === shown && width(c.text) === 1 ? { ...c, text: '▌', color: p.neon, bold: false, dim: false, live: true } : { ...c, text: blank, live: true }
  }
}

/** The newest log row types itself in, with a cursor. */
function logMotion(line: Line, k: SkinContext, p: Palette): void {
  const row = line.row
  if (!line.cells || row.kind === 'keys' || row.kind === 'input' || row.at === undefined) return
  const since = k.o.now - row.at
  if (since < 0 || since >= EFFECT_MS.type) return
  const shown = Math.floor((since / EFFECT_MS.type) * line.cells.length)
  typeIn(line.cells, 0, line.cells.length, shown, p)
}

/** The advisor's `◆` lights at a call. */
function advisorMotion(line: Line, k: SkinContext, p: Palette): void {
  const last = k.s.advisor.calls[k.s.advisor.calls.length - 1]
  if (!line.cells || !last) return
  const since = k.o.now - last.at
  if (since < 0 || since >= EFFECT_MS.advisor) return
  const steps = p.hex ? ['#FFFFFF', '#E6D9FF', '#C9B1FF'] : [flash(k, p), 'magentaBright', FAMILY_COLOR.fable]
  const color = steps[Math.min(steps.length - 1, Math.floor((since / EFFECT_MS.advisor) * steps.length))]!
  line.cells.forEach((c, j) => {
    if (c.part === 'advisor') line.cells![j] = { ...c, color, bold: true, live: true }
  })
}

/**
 * An agent's events on its first row: a new one's name types in and its branch
 * lights; a finished one's sign flashes white to green; a failed one's name
 * falls apart into block noise for a moment; a waiting one's sign blinks.
 */
function agentMotion(line: Line, a: TreeAgent, k: SkinContext, p: Palette): void {
  const cells = line.cells
  if (!cells) return
  const f = k.o.frame
  const now = k.o.now
  const sign = cells.findIndex(c => c.part === 'sign')
  const name = cells.map((c, j) => (c.part === 'name' ? j : -1)).filter(j => j >= 0)
  const active = a.state === 'running' || a.state === 'starting' || a.state === 'waiting'
  const born = now - a.startedAt
  if (active && born >= 0 && born < EFFECT_MS.spawn && name.length > 0) {
    const from = name[0]!
    const to = name[name.length - 1]! + 1
    typeIn(cells, from, to, from + Math.floor((born / EFFECT_MS.spawn) * (to - from)), p)
    // its branch lights: the guide cells before its sign
    for (let j = 0; j < sign; j++) if (cells[j]!.part === 'guide' && cells[j]!.text.trim() !== '') cells[j] = { ...cells[j]!, color: flash(k, p), live: true }
  }
  const ended = a.endedAt === undefined ? Number.POSITIVE_INFINITY : now - a.endedAt
  if (a.state === 'done' && ended >= 0 && ended < EFFECT_MS.done && sign >= 0) {
    const steps = p.hex ? ['#FFFFFF', '#CFFFE0', '#7CFFB2'] : [flash(k, p), 'greenBright', 'success']
    cells[sign] = { ...cells[sign]!, color: steps[Math.min(2, Math.floor((ended / EFFECT_MS.done) * 3))]!, bold: true, live: true }
  }
  if (a.state === 'failed' && ended >= 0 && ended < EFFECT_MS.glitch) {
    for (const j of name) {
      const c = cells[j]!
      const n = (j * 7 + f * 13) % 10
      if (width(c.text) === 1 && n < 5) cells[j] = { ...c, text: GLITCH[(j + f) % GLITCH.length]!, color: n % 2 ? 'redBright' : 'red', live: true }
    }
    if (sign >= 0) cells[sign] = { ...cells[sign]!, color: f % 2 ? flash(k, p) : 'redBright', live: true }
  }
  if (a.state === 'waiting' && sign >= 0) {
    cells[sign] = { ...cells[sign]!, color: Math.floor(f / 4) % 2 ? (p.hex ? '#FFF2B0' : 'yellowBright') : 'warning', live: true }
  }
}

/** A panel just opened unfolds, a row at a time, from its top edge. */
function unfold(lines: Line[], k: SkinContext): void {
  const opened = k.o.openedAt
  if (opened === undefined) return
  const since = k.o.now - opened
  if (since < 0 || since >= EFFECT_MS.unfold) return
  let top = -1
  lines.forEach((l, i) => {
    const r = l.row
    if (r.kind === 'keys' || r.kind === 'input') return
    if (r.role === 'frame-top') top = i
    if (top < 0) return
    const n = i - top
    const bottom = r.role === 'frame-bottom'
    const rowsInPanel = Math.max(1, lines.slice(top).findIndex(x => x.row.kind !== 'keys' && x.row.kind !== 'input' && x.row.role === 'frame-bottom') + 1)
    const shown = Math.floor((since / EFFECT_MS.unfold) * rowsInPanel)
    if (n > shown && l.cells) l.cells = l.cells.map(c => ({ text: ' '.repeat(width(c.text)), live: true }))
    else if (l.cells) l.cells = l.cells.map(c => ({ ...c, live: true }))
    if (bottom) top = -1
  })
}

/** A scan line runs down the pane every few seconds, lighting the frame's lines (never the text). */
function scan(lines: Line[], k: SkinContext, p: Palette): void {
  const at = (k.o.frame % SCAN_EVERY) - 2
  for (const [i, t] of [
    [at, 0.6],
    [at - 1, 0.3],
  ] as const) {
    const l = lines[i]
    if (!l?.cells) continue
    l.cells = l.cells.map(c => (c.part === 'rail' || c.part === 'frame' || c.part === 'rule' || c.part === 'guide' ? { ...c, color: lighter(c.color, t, p, k) } : c))
  }
}

/** The braille radar beside the empty tree's words: a ring, a sweep with its trail, two contacts lit as it passes. */
export function radarCells(frame: number, w: number, h: number, p: Palette): Cell[][] {
  const W = w * 2
  const H = h * 4
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  const R = Math.min(cx, cy) - 0.2
  const level = Array.from({ length: H }, () => new Array<number>(W).fill(0))
  const put = (x: number, y: number, v: number): void => {
    const X = Math.round(x)
    const Y = Math.round(y)
    if (X >= 0 && X < W && Y >= 0 && Y < H) level[Y]![X] = Math.max(level[Y]![X]!, v)
  }
  for (let a = 0; a < Math.PI * 2; a += 0.05) put(cx + R * Math.cos(a), cy + R * Math.sin(a), 1)
  for (let a = 0; a < Math.PI * 2; a += 0.35) put(cx + R * 0.5 * Math.cos(a), cy + R * 0.5 * Math.sin(a), 1)
  put(cx, cy, 2)
  const th = (frame % 24) * ((Math.PI * 2) / 24)
  const ray = (a: number, v: number): void => {
    for (let t = 0; t <= R - 0.6; t += 0.4) put(cx + t * Math.cos(a), cy + t * Math.sin(a), v)
  }
  ray(th - 0.5, 2)
  ray(th - 0.25, 3)
  ray(th, 4)
  for (const [a, r] of [
    [0.9, 0.62],
    [3.9, 0.38],
  ] as const) {
    let since = (th - a) % (Math.PI * 2)
    if (since < 0) since += Math.PI * 2
    const glow = since < 0.3 ? 5 : since < 1.6 ? 4 : since < 3.2 ? 3 : 0
    if (glow) put(cx + R * r * Math.cos(a), cy + R * r * Math.sin(a), glow)
  }
  const colors = p.hex ? ['', '#2A93A1', '#46CBDA', '#8AF1FB', '#D8FDFF', '#FFFFFF'] : ['', 'cyan', 'cyan', 'cyanBright', 'cyanBright', 'whiteBright']
  const bits = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ]
  const out: Cell[][] = []
  for (let r = 0; r < h; r++) {
    const row: Cell[] = []
    for (let c = 0; c < w; c++) {
      let code = 0
      let top = 0
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const v = level[r * 4 + dy]![c * 2 + dx]!
          if (v) {
            code |= bits[dy]![dx]!
            top = Math.max(top, v)
          }
        }
      row.push(code ? { text: String.fromCharCode(0x2800 + code), color: colors[top], live: true } : { text: ' ' })
    }
    out.push(row)
  }
  return out
}

/** The radar on the empty tree's rows, at their right; the `◌` beside the words blinks. */
function radar(lines: Line[], k: SkinContext, p: Palette): void {
  const first = lines.findIndex(l => l.row.kind === 'text' && l.row.role === 'radar')
  if (first < 0) return
  const picture = radarCells(k.o.animate ? k.o.frame : 3, RADAR.w, RADAR.h, p)
  const col = k.cols - RADAR.w - 1
  for (let r = 0; r < RADAR.h; r++) {
    const l = lines[first + r]
    if (!l || l.row.kind !== 'text' || l.row.role !== 'radar' || !l.cells) continue
    const cells = l.cells
    while (columns(cells).length > 0 && cells.reduce((n, c) => n + width(c.text), 0) < col) cells.push({ text: ' ' })
    if (cells.length === 0) for (let c = 0; c < col; c++) cells.push({ text: ' ' })
    // cut to the radar's column, then the radar, then the pane's last cell
    let used = 0
    const keep: Cell[] = []
    for (const c of cells) {
      if (used + width(c.text) > col) break
      keep.push(c)
      used += width(c.text)
    }
    while (used < col) {
      keep.push({ text: ' ' })
      used += 1
    }
    const blink = (c: Cell): Cell =>
      c.part !== 'blink' ? c : k.o.animate ? { ...c, color: Math.floor(k.o.frame / 4) % 2 ? p.neonHi : p.neon, live: true } : { ...c, color: p.neon }
    l.cells = [...keep.map(blink), ...picture[r]!, { text: ' ' }]
  }
}

/** A workflow run's squad bar before its description: a cell an agent, in its state's color; one at work shimmers. */
function squad(line: Line, k: SkinContext, p: Palette): void {
  const row = line.row
  if (!line.cells || row.kind === 'keys' || row.kind === 'input' || row.run === undefined) return
  const run = runOf(k.s, row.run)
  if (!run) return
  const t = runTally(k.s, run)
  const counts: Array<[number, string, boolean]> = [
    [t.done, p.hex ? '#3DDC84' : 'success', false],
    [t.active, modelColor(k.s.agents.find(a => a.run === run.id && (a.state === 'running' || a.state === 'starting'))?.model) ?? (p.hex ? '#7CFFB2' : 'success'), true],
    [t.waiting + t.stopped, p.hex ? '#FFC93C' : 'warning', false],
    [t.failed, p.hex ? '#FF4D6D' : 'error', false],
  ]
  const total = counts.reduce((n, c) => n + c[0], 0)
  if (total === 0) return
  // at most 12 cells: a larger run's counts shrink in proportion, none of them to nothing
  const most = 12
  const scale = total > most ? most / total : 1
  const bar: Cell[] = []
  for (const [n, color, working] of counts) {
    const m = n === 0 ? 0 : Math.max(1, Math.round(n * scale))
    for (let i = 0; i < m; i++) {
      const lit = working && k.o.animate && (Math.floor(k.o.frame / 2) + i) % 2 === 0
      bar.push({ text: '▌', color: lit ? lighter(color, 0.55, p) : color, ...(working && k.o.animate ? { live: true as const } : {}) })
    }
  }
  const text = line.cells.findIndex(c => c.part !== 'guide' && c.text.trim() !== '')
  if (text < 0) return
  line.cells.splice(text, 0, ...bar, { text: ' ' })
}

/** The rows a frame of motion makes: every effect laid over the skinned rows, every row still `cols` wide. */
function motion(rows: readonly Row[], k: SkinContext, p: Palette): Row[] {
  const lines: Line[] = rows.map(row => ({ row, cells: row.kind === 'keys' || row.kind === 'input' || (row.kind === 'text' && row.covered) ? undefined : split(row.segs) }))
  // what stands still too: the radar's picture, the squad bars
  radar(lines, k, p)
  for (const l of lines) if (l.row.kind === 'text' && l.row.role === 'about') squad(l, k, p)
  if (k.o.animate) {
    for (const l of lines) {
      const r = l.row
      if (r.kind === 'keys' || r.kind === 'input') continue
      if (r.role === 'title') titleMotion(l, k, p)
      if (r.role === 'main') coreMotion(l, k, p)
      if (l.cells?.some(c => c.part === 'advisor')) advisorMotion(l, k, p)
      if (r.agent !== undefined) {
        const a = k.s.agents.find(x => x.id === r.agent)
        if (a) agentMotion(l, a, k, p)
      }
    }
    comets(lines, k, p)
    // the newest log row: the first one
    const log = lines.find(l => l.row.kind === 'text' && l.row.role === 'log')
    if (log) logMotion(log, k, p)
    unfold(lines, k)
    scan(lines, k, p)
  }
  return lines.map(l => (l.cells ? withSegs(l.row, fitTo(merge(l.cells), k.cols)) : l.row))
}

/**
 * When an event's effect still runs, at the latest: the ticker draws every
 * frame until then, so a short effect does not wait for the idle pace.
 */
export function effectsEnd(s: TreeState): number {
  let end = 0
  const newest = s.log[0]
  if (newest) end = Math.max(end, newest.at + EFFECT_MS.type)
  const call = s.advisor.calls[s.advisor.calls.length - 1]
  if (call) end = Math.max(end, call.at + EFFECT_MS.advisor)
  for (const a of s.agents) {
    end = Math.max(end, a.startedAt + EFFECT_MS.spawn)
    if (a.endedAt !== undefined) end = Math.max(end, a.endedAt + Math.max(EFFECT_MS.done, EFFECT_MS.glitch))
  }
  return end
}

// ── the boot sequence (F3) ──────────────────────────────────────────────

/**
 * The pane's first opening in a process: the title types itself in, the
 * systems report one by one (core, context, limits, advisor, agents: each
 * `OK`), a bar fills, then the pane draws itself in from the top, a bright
 * edge running down. As many rows as the pane, every one `cols` wide.
 */
function bootRows(pane: readonly Row[], k: SkinContext, p: Palette, since: number): Row[] {
  const n = Math.max(1, pane.length)
  const cols = k.cols
  const blank = (): Seg[] => [{ text: ' '.repeat(cols), live: true }]
  const row = (segs: Seg[]): Row => ({ kind: 'text', segs: fitTo(pad(segs, cols), cols) })
  const on = (segs: Seg[]): Seg[] => (p.plate ? segs.map(x => (x.bg ? x : { ...x, bg: p.plate })) : segs)
  if (since >= BOOT_MS.bar) {
    // the pane drawn in, a bright edge running down
    const edge = Math.floor(((since - BOOT_MS.bar) / (BOOT_MS.reveal - BOOT_MS.bar)) * (n + 1))
    return pane.map((r, i) => {
      if (i < edge) return r
      if (i === edge && r.kind !== 'keys' && r.kind !== 'input') return withSegs(r, r.segs.map(x => ({ ...x, color: x.text.trim() ? flash(k, p) : x.color, live: true })))
      return row(on(blank()))
    })
  }
  const out: Seg[][] = Array.from({ length: n }, () => blank())
  const title = 'AGENT TREE // FORGE'
  const typed = Math.min(title.length, Math.floor(since / 15))
  out[0] = [{ text: '◢◤', color: p.neon, live: true }, { text: ' ' }, { text: title.slice(0, typed), color: p.neon, bold: true }, ...(typed < title.length ? [{ text: '▌', color: p.neon }] : [])]
  if (n > 2 && since >= 250) out[1] = [{ text: `┌${'┄'.repeat(Math.max(0, cols - 2))}┐`, color: p.rail, live: true }]
  const s = k.s
  const w = k.w
  const model = modelName(s.main.model)?.long ?? 'main'
  const effort = effortName(s.main.effort)
  const limits = (s.main.limits ?? []).map(l => `${Math.round(l.percent)}%`).join(' · ')
  const advisor = s.advisor.off ? w.offLabel : (modelName(s.advisor.model)?.long ?? 'advisor')
  const report: Array<[string, string]> = [
    [upper(w.hud.core, w.lang), effort ? `${model} · ${effort}` : model],
    ['CTX', s.main.contextPercent === undefined ? '—' : `${Math.round(s.main.contextPercent)}%`],
    [upper(w.hud.limits, w.lang), limits || '—'],
    ['ADVISOR', advisor],
    [upper(w.agents, w.lang), String(s.agents.length)],
  ]
  const room = Math.max(0, n - 4)
  report.slice(0, room).forEach(([label, value], i) => {
    const at = 300 + i * 160
    if (since < at) return
    const done = since >= at + 120
    const lead: Seg[] = [{ text: '▸ ', color: p.neon }, { text: label.padEnd(9), color: p.railLabel }, { text: value }]
    const tail: Seg[] = done ? [{ text: ' ' }, { text: 'OK', color: p.hex ? '#3DDC84' : 'success', bold: true }] : [{ text: ' ' }, { text: SPIN[k.o.frame % SPIN.length]!, color: p.neon }, { text: ' ' }]
    const dots = Math.max(1, cols - cells(lead) - cells(tail) - 1)
    out[2 + i] = [...lead, { text: ' ' }, { text: '·'.repeat(dots), color: p.rail }, ...tail]
  })
  if (since >= BOOT_MS.lines && n > 3) {
    const lit = Math.min(cols, Math.round(((since - BOOT_MS.lines) / (BOOT_MS.bar - BOOT_MS.lines)) * cols))
    const unlit = p.hex ? mix(p.neon, GROUND, 0.78) : p.neon
    const at = Math.min(n - 1, 2 + Math.min(room, report.length) + 1)
    out[at] = [{ text: '▌'.repeat(lit), color: p.neon, live: true }, { text: (p.hex ? '▌' : '▏').repeat(cols - lit), color: unlit }]
  }
  return out.map(segs => row(on(segs.map(x => ({ ...x, live: true })))))
}

function pad(segs: Seg[], cols: number): Seg[] {
  const room = cols - cells(segs)
  return room > 0 ? [...segs, { text: ' '.repeat(room) }] : segs
}

// ── the skin ────────────────────────────────────────────────────────────

/** Where the header ends: the rows before the first rail that opens no header group. */
function plateEnd(rows: readonly Row[]): number {
  const at = rows.findIndex(r => (r.kind === 'text' || r.kind === 'press') && r.role === 'rail' && (r.rail?.label === undefined || r.rail.label === 'log'))
  // A pane so short it holds the header alone: all of it.
  return at < 0 ? rows.length : at
}

/** One classic row in the HUD's look, still: its tagged parts redrawn, as wide as the pane. */
function still(row: Row, k: SkinContext, p: Palette): Row {
  if (row.kind === 'keys' || row.kind === 'input') return row
  if (row.kind === 'text' && row.covered) return row
  let out: Row = row
  if (row.role === 'title') out = titleRow(row, k, p)
  else if (row.role === 'rail' && row.rail) out = railRow(row, row.rail, k, p)
  else if (row.role === 'main') out = mainRow(row, k, p)
  else if (row.role === 'frame-top') out = frameTop(row, k, p)
  else if (row.role === 'frame-bottom') out = frameBottom(row, k, p)
  else if (row.role === 'frame-side') out = frameSide(row, p)
  let segs = rowSegs(out) ?? []
  segs = bars(segs, k, p)
  segs = guides(segs, p)
  segs = segs.map(s => {
    if (s.part === 'label') return { ...s, text: upper(s.text, k.w.lang) }
    if (s.part === 'heading') return { ...s, text: upper(s.text, k.w.lang), color: p.neon, bold: true }
    if (s.part === 'name' && p.hex && s.color && s.color in NAME_NEON) return { ...s, color: NAME_NEON[s.color as keyof typeof NAME_NEON] }
    return s
  })
  return withSegs(out, fitTo(segs, k.cols))
}

/** The classic rows in the Forge HUD's look, every one as wide as before; moving where the pane moves. */
export function skin(rows: readonly Row[], k: SkinContext): Row[] {
  const p = paletteOf(k.o.theme)
  const plate = p.plate !== undefined ? plateEnd(rows) : 0
  const moved = motion(
    rows.map(row => still(row, k, p)),
    k,
    p,
  )
  const plated = moved.map((row, i) => {
    if (i >= plate || !p.plate || row.kind === 'keys' || row.kind === 'input') return row
    const pad = k.cols - cells(row.segs)
    return withSegs(row, [...row.segs.map(s => (s.bg ? s : { ...s, bg: p.plate })), ...(pad > 0 ? [{ text: ' '.repeat(pad), bg: p.plate }] : [])])
  })
  // The boot sequence (F3), on the pane's first opening in the process.
  const boot = k.o.bootAt
  if (k.o.animate && boot !== undefined) {
    const since = k.o.now - boot
    if (since >= 0 && since < BOOT_MS.reveal) return bootRows(plated, k, p, since)
  }
  return plated
}
