import { describe, expect, test } from 'claude-code/testing'

import { BAND_GAP, DEFAULT_SETTINGS, PICKED_COLOR, aliasOf, bandLine, fieldKey, frameRows, hasLiveCell, isButton, layout, modelChoiceLabel, rowWidth, runOpen } from '../hooks/layout'
import { PULSE_COLOR, TIME_COLOR, TITLE_COLOR, TRUNK_COLOR, width } from '../hooks/format'
import { LANGS, wordsFor } from '../hooks/words'
import type { Row, Settings } from '../hooks/layout'
import { emptyTree } from '../hooks/model'
import type { PickerId, TreeUi } from '../types'
import { NOW, busyTree, workflowTree } from './fixture'

const UI: TreeUi = { showFinished: false, showLog: true, view: 'tree' }
const HU: TreeUi = { ...UI, lang: 'hu' }
const PICKERS: PickerId[] = ['lang', 'model', 'effort', 'advisor', 'agentModel', 'agentEffort']
/** Every language, with no panel and with each panel open. */
/** The pane in every language it speaks. */
const ALL_LANGS: TreeUi[] = LANGS.map(l => ({ ...UI, lang: l.code }))
const VARIANTS: TreeUi[] = ALL_LANGS.flatMap(ui => [
  ui,
  ...PICKERS.map(picker => ({ ...ui, picker })),
  { ...ui, picker: 'runModel' as const, pickerFor: 'a1' },
  // the message panel at the foot: to a running agent, and to a finished one, an effort chosen
  { ...ui, compose: 'a1' },
  { ...ui, compose: 't1', composeEffort: 'max' },
])
/** With workflow runs (plan 05): closed, one opened, all shown, and the message panel open beside them. */
const WF_VARIANTS: TreeUi[] = ALL_LANGS.flatMap(ui => [ui, { ...ui, openRuns: ['wf_review'] }, { ...ui, showFinished: true }, { ...ui, compose: 'a1' }])

function lineOf(row: Row): string {
  if (row.kind === 'keys') return row.items.map(i => (isButton(i) ? `${i.hotkey}: ${i.label}` : i.text)).join('  ')
  return row.segs.map(s => s.text).join('')
}

function draw(cols: number, rows?: number, ui: TreeUi = UI, s = busyTree()): string[] {
  return layout(s, ui, { cols, rows, now: NOW, frame: 2, animate: true }).map(lineOf)
}

describe('every row fits the pane', () => {
  for (const cols of [36, 44, 56, 71, 72, 78, 120]) {
    for (const rows of [undefined, 40, 24, 16, 12, 10]) {
      test(`${cols} columns, ${rows ?? 'all'} rows, in every language, the panel closed and open, with workflow runs`, () => {
        const cases = [...VARIANTS.map(ui => ({ ui, s: busyTree })), ...WF_VARIANTS.map(ui => ({ ui, s: workflowTree }))]
        for (const { ui, s } of cases) {
          const which = `${ui.lang ?? 'en'}${ui.picker ? ` + ${ui.picker} panel` : ''}${ui.compose ? ` + message to ${ui.compose}` : ''}${s === workflowTree ? ` + runs${ui.openRuns ? ' opened' : ''}${ui.showFinished ? ' all' : ''}` : ''}`
          const drawn = layout(s(), ui, { cols, rows, now: NOW, frame: 0, animate: true })
          for (const row of drawn) {
            expect(rowWidth(row) <= cols, `${which}: ${rowWidth(row)} > ${cols}: ${lineOf(row)}`).toBe(true)
            if (row.kind === 'press') expect(rowWidth(row), `${which}: a pressable row fills the width: ${lineOf(row)}`).toBe(cols)
          }
          if (rows !== undefined) expect(drawn.length <= rows, `${which}: ${drawn.length} rows > ${rows}`).toBe(true)
          if (ui.picker) expect(drawn.some(r => lineOf(r).startsWith('╭─ ')), `${which}: the panel shows`).toBe(true)
          if (ui.compose) {
            // the whole message panel shows, the field under its frame, and the field ends the pane
            expect(drawn.some(r => lineOf(r).startsWith('╭─ ✎')), `${which}: the message panel shows`).toBe(true)
            const field = drawn.findIndex(r => r.kind === 'input')
            expect(field > 0, `${which}: the field shows`).toBe(true)
            expect(lineOf(drawn[field - 1]!).startsWith('╰'), `${which}: the field is under the frame`).toBe(true)
            expect(drawn.slice(field + 1).every(r => r.kind === 'text' && r.covered === true), `${which}: the field ends the pane`).toBe(true)
          }
        }
      })
    }
  }
  test('the help view and the empty pane fit too, in every language', () => {
    for (const cols of [36, 56, 78]) {
      for (const ui of ALL_LANGS) {
        const help = layout(busyTree(), { ...ui, view: 'help' }, { cols, now: NOW, frame: 0, animate: true })
        const empty = layout(emptyTree(NOW), ui, { cols, now: NOW, frame: 0, animate: true })
        for (const row of [...help, ...empty]) expect(rowWidth(row) <= cols, lineOf(row)).toBe(true)
      }
    }
  })
})

describe('the normal view (56 columns)', () => {
  const lines = draw(56)
  const text = lines.join('\n')

  test('opens with the plugin name', () => {
    expect(lines[0]).toBe(`Agent Tree // Forge${' '.repeat(34)}▾en`)
  })

  test('shows the main session with its cost', () => {
    // an empty row after the title (the user's request)
    expect(lines[1]?.trim()).toBe('')
    expect(lines[2]).toContain('● ▾Opus 5.5 · ▾high')
    expect(lines[2]?.trimEnd().endsWith('≈$1.84')).toBe(true)
    expect(lines[2]).not.toContain('5h')
  })

  test('shows the session and the all-models limit under the advisor, with when each resets (the day by its full name)', () => {
    expect(lines[7]).toBe('session ██▎░░░░░░░ 23%           resets 16:24 · in 2h12m')
    expect(lines[8]).toBe('all     ████▏░░░░░ 41%     resets Friday 18:12 · in 2d4h')
  })

  test('gives the context a row: weather, tokens over the window, the change over the last turn', () => {
    // the bar where the limit bars start ("session "), the share where theirs ends (the user's request)
    expect(lines[3]).toBe('ctx  ☁  ████▊░░░░░ 47%  94.0k / 200k  ▲ +23.7k last turn')
  })

  test('shows the advisor right under the context: its name and calls, then its last call and their average length; the team last', () => {
    expect(lines[4]).toBe('◆ ▾Fable 5.2 advisor         3 calls · main 2 · agents 1')
    expect(lines[5]).toBe('  last: main · 2m ago · 4.1s                    avg 4.4s')
    // an empty row after the advisor and one before the team (the user's request)
    expect([lines[6]?.trim(), lines[9]?.trim()]).toEqual(['', ''])
    expect(lines[10]?.trimEnd()).toBe('team  Opus × 2  Haiku × 5  Sonnet × 2  ◆ × 3')
  })

  test('draws working agents on two lines with their model and context', () => {
    expect(text).toContain('├─ ⠹ Find auth handlers')
    expect(text).toMatch(/Find auth handlers ◆1 +✎ ▾Haiku 5\.5 · low +38s/)
    // the status line: type, then the ctx at the end; the command on a line of its own
    expect(text).toMatch(/├─ ⠹ Find auth handlers.*\n│ {4}Explore +ctx ☀  ▉░░░░ 18%\n│ {4}Grep src\/auth\/\*\*\n├─ /)
  })

  test('keeps waiting and failed agents visible, collapses older finished ones', () => {
    expect(text).toContain('‖ Migrate session store')
    expect(text).toContain('general-purpose · waiting')
    expect(text).toContain('✗ Review auth diff')
    expect(text).toContain('reviewer · ended with error')
    expect(text).toContain('✓ Run test suite')
    expect(text).not.toContain('Map the repo')
    expect(text).toContain('└─ + 3 finished')
  })

  test('lists the log, newest first, and the keys', () => {
    expect(text).toMatch(/14:10 ◆ advisor {10}called by main +4\.1s/)
    expect(lines[lines.length - 1]).toBe('↵ open  f: finished  l: log  o: options  h: help')
  })

  test('shows every finished agent once asked', () => {
    const all = draw(56, undefined, { ...UI, showFinished: true }).join('\n')
    expect(all).toContain('Map the repo')
    expect(all).not.toContain('+ 3 finished')
  })

  test('hides the log once asked', () => {
    expect(draw(56, undefined, { ...UI, showLog: false }).join('\n')).not.toContain('called by main')
  })
})

describe('other widths and heights', () => {
  test('the narrow view keeps one line per agent and short model names', () => {
    const text = draw(36).join('\n')
    expect(text).toMatch(/Find auth h\S*… ◆1 ✎▾H5\.5 lo +38s/)
    expect(text).toMatch(/Migrate sessio\S*… ✎▾S5\.5 md 1m00s/)
    expect(text).not.toContain('Grep src/auth')
    expect(text).toContain('O × 2 H × 5 S × 2 ◆ × 3')
    expect(text).toContain('ctx ☁  ██▉░░░ 47%       94.0k / 200k')
    expect(text).not.toContain('last turn')
  })

  test('the wide view adds effort, tokens, cost and limits', () => {
    const text = draw(78).join('\n')
    expect(text).toContain('▾Haiku 5.5 · low')
    expect(text).toContain('21k  ≈$0.04')
    expect(text).toContain('resets 16:24 · in 2h12m')
    expect(text).toContain('resets Friday 18:12 · in 2d4h')
    expect(text).toContain('94.0k / 200k  ▲ +23.7k last turn')
  })

  test('a short pane drops the log first, then detail, and keeps who needs attention', () => {
    const short = draw(56, 12)
    expect(short.length <= 12).toBe(true)
    const text = short.join('\n')
    expect(text).toContain('Migrate session store')
    expect(text).toContain('Find auth handlers')
    expect(text).not.toContain('called by main')
  })

  test('a very short pane sums up what it leaves out', () => {
    const text = draw(56, 10).join('\n')
    expect(text).toContain('Migrate session store')
    expect(text).toMatch(/\+ \d+ more/)
  })

  test('a widget draws one glance row', () => {
    const wide = layout(busyTree(), UI, { cols: 90, placement: 'widget', now: NOW, frame: 0, animate: true })
    expect(wide.length).toBe(1)
    expect(lineOf(wide[0]!)).toContain('Opus 5.5 · 2 running · 1 waiting · 4 done · 1 failed')
    const narrow = layout(busyTree(), UI, { cols: 56, placement: 'widget', now: NOW, frame: 0, animate: true })
    expect(lineOf(narrow[0]!)).toMatch(/^⠋ Opus 5\.5 · 2 running .*… ◆3 · ≈\$1\.84$/)
  })

  test('without motion the spinner stands still', () => {
    const text = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 3, animate: false }).map(lineOf).join('\n')
    expect(text).toContain('├─ ● Find auth handlers')
  })
})

describe('colors', () => {
  const segsOf = (cols: number) => layout(busyTree(), UI, { cols, now: NOW, frame: 0, animate: true }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))

  test('the context bar and its share take the weather color, red from 90%', () => {
    // still: no light running along the bar
    const segs = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: false }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    expect(segs.find(s => s.text === '████')?.color).toBe('cyan')
    expect(segs.find(s => s.text === '▊')?.color).toBe('cyan')
    expect(segs.find(s => s.text === ' 47%')?.color).toBe('cyan')
    expect(segs.find(s => s.text === '▉')?.color).toBe('yellow')
    const full = busyTree()
    full.main.contextPercent = 93
    const red = layout(full, UI, { cols: 56, now: NOW, frame: 0, animate: true }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    expect(red.find(s => s.text === '↯ ')?.color).toBe('red')
    expect(red.find(s => s.text === ' 93%')?.color).toBe('red')
  })

  test('a working agent\'s time is drawn in the time color, not dimmed', () => {
    const time = segsOf(56).find(s => s.text === '     38s')
    expect(time).toMatchObject({ color: 'planMode' })
    expect(time?.dim).toBeUndefined()
  })

  test('the name at the top is bold and colored', () => {
    expect(segsOf(56)[0]).toMatchObject({ text: 'Agent Tree // Forge', bold: true, color: 'cyan' })
  })
})

describe('an estimated context', () => {
  test('is drawn with ~ in the weather color, in every width', () => {
    const s = busyTree()
    s.main.contextPercent = 12
    s.main.contextTokens = 24_000
    s.main.contextEstimated = true
    const at = (cols: number) => layout(s, UI, { cols, now: NOW, frame: 0, animate: true }).map(lineOf).join('\n')
    expect(at(56)).toContain('ctx  ☀  █▎░░░░░░░░ ~12%')
    expect(at(36)).toContain('~12%')
    expect(at(78)).toContain('~24.0k / 200k')
    // an estimate has no change over a turn to show
    expect(at(56)).not.toContain('last turn')
  })
})

describe('effort', () => {
  test('the session header shows its effort, not dimmed', () => {
    const segs = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: true }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    const effort = segs.find(s => s.text === 'high')
    expect(effort).toBeDefined()
    expect(effort?.dim).toBeUndefined()
  })

  test('every agent row shows its effort beside its model, the times in one column', () => {
    const lines = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: true }).map(lineOf)
    const rows = lines.filter(l => /^├─ |^└─ /.test(l) && !l.includes('finished'))
    expect(rows.map(l => l.length)).toEqual(rows.map(() => 56))
    expect(lines.join('\n')).toContain('▾Sonnet 5.5 · med   1m00s')
    // an agent with no effort known keeps its time in the same column
    const ends = rows.map(l => l.trimEnd().length)
    expect(new Set(ends).size).toBe(1)
  })

  test('the wide view shows the full effort names', () => {
    const text = layout(busyTree(), UI, { cols: 78, now: NOW, frame: 0, animate: true }).map(lineOf).join('\n')
    expect(text).toContain('▾Haiku 5.5 · low')
    expect(text).toContain('▾Sonnet 5.5 · med')
  })
})

describe('the context bar and the limit bars', () => {
  const columns = (rows: string[], start: RegExp) => {
    const row = rows.find(l => start.test(l)) ?? ''
    // in cells, not characters: a wide label (Japanese, Korean, Chinese) takes two a character
    const bar = width(row.slice(0, row.search(/[█▏▎▍▌▋▊▉░]/)))
    const share = row.search(/\d+%/)
    return { bar, end: width(row.slice(0, share)) + (/\d+%/.exec(row.slice(share))?.[0].length ?? 0) }
  }

  test('start in one column, and their shares end in one, in the normal and the wide view, in every language (the user\'s request)', () => {
    for (const cols of [56, 78]) {
      for (const ui of ALL_LANGS) {
        for (const estimated of [false, true]) {
          const s = busyTree()
          if (estimated) {
            s.main.contextEstimated = true
            s.main.contextPercent = 5
          }
          const lines = layout(s, ui, { cols, now: NOW, frame: 0, animate: false }).map(lineOf)
          const ctx = columns(lines, /^ctx /)
          const session = columns(lines.filter(l => !l.startsWith('ctx ')), /[█▏▎▍▌▋▊▉░]+.* \d+%/)
          expect(ctx.bar, `${ui.lang} ${cols} ${estimated ? '~' : ''}`).toBe(session.bar)
          expect(ctx.end, `${ui.lang} ${cols} ${estimated ? '~' : ''}`).toBe(session.end)
        }
      }
    }
  })
})

describe('the context row', () => {
  const ctxLine = (cols: number, change?: (s: ReturnType<typeof busyTree>) => void) => {
    const s = busyTree()
    change?.(s)
    return layout(s, UI, { cols, now: NOW, frame: 0, animate: true }).map(lineOf).find(l => l.startsWith('ctx ')) ?? ''
  }

  test('gives way from the end as the pane narrows: last turn, the change, the tokens', () => {
    expect(ctxLine(56)).toContain('▲ +23.7k last turn')
    expect(ctxLine(48)).toMatch(/94\.0k \/ 200k  ▲ \+23\.7k$/)
    expect(ctxLine(44)).toMatch(/47% +94\.0k \/ 200k$/)
    expect(ctxLine(36)).toMatch(/47% +94\.0k \/ 200k$/)
  })

  test('a shrinking context, after a compaction, shows ▼', () => {
    expect(ctxLine(56, s => (s.main.turnDelta = -412_000))).toContain('▼ -412.0k last turn')
  })

  test('is left out while the window is unknown', () => {
    const line = ctxLine(56, s => {
      s.main.contextPercent = undefined
    })
    expect(line).toBe('')
  })

  test('a short pane gives way from the header in order, never the context', () => {
    // the header: the lines above the first separator
    const head = (rows: number) => {
      const lines = layout(busyTree(), UI, { cols: 56, rows, now: NOW, frame: 0, animate: true }).map(lineOf)
      return lines.slice(0, lines.findIndex(l => l.startsWith('───'))).map(l => l.split(' ')[0])
    }
    expect(head(16)).toEqual(['Agent', '●', 'ctx', '◆', '', 'session', 'all', 'team', 'agents'])
    // the advisor's last call first, then the subagents' row while it is on auto
    expect(head(15)).toEqual(['Agent', '●', 'ctx', '◆', 'session', 'all', 'team', 'agents'])
    // the advisor's last call first, then the team, the weekly limit, the advisor, the session's limit
    expect(head(14)).toEqual(['Agent', '●', 'ctx', '◆', 'session', 'all', 'team'])
    // a choice for new subagents keeps their row, right after the context
    const chosen = layout({ ...busyTree(), choices: { agentEffort: 'low' } }, UI, { cols: 56, rows: 11, now: NOW, frame: 0, animate: true }).map(lineOf)
    expect(chosen.slice(0, chosen.findIndex(l => l.startsWith('───'))).map(l => l.split(' ')[0])).toEqual(['Agent', '●', 'ctx', 'agents'])
    expect(head(13)).toEqual(['Agent', '●', 'ctx', '◆', 'session', 'all'])
    expect(head(12)).toEqual(['Agent', '●', 'ctx', '◆', 'session'])
    expect(head(11)).toEqual(['Agent', '●', 'ctx', 'session'])
    expect(head(10)).toEqual(['Agent', '●', 'ctx'])
  })
})

describe('every time in one color', () => {
  const segs = () => layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: true }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
  const timeLike = /^\s*(\d+h)?\d+(m\d\ds|m|s)( ago)?$|^\s*\d+\.\ds$|^\d\d:\d\d$|^\d+[hd]$/

  test('ages, durations, elapsed times and the log clock are all in the time color', () => {
    const times = segs().filter(s => timeLike.test(s.text))
    expect(times.length > 10).toBe(true)
    for (const t of times) expect(t, `"${t.text}"`).toMatchObject({ color: 'planMode' })
    for (const t of times) expect(t.dim, `"${t.text}" is not dimmed`).toBeUndefined()
  })

  test('the advisor row keeps who in dim and draws the age with its "ago" in the time color', () => {
    const all = segs()
    expect(all.find(s => s.text === '2m ago')).toMatchObject({ color: 'planMode' })
    expect(all.find(s => s.text === '  last: ')).toMatchObject({ dim: true })
    expect(all.find(s => s.text === 'main' && s.dim)).toBeDefined()
    expect(all.find(s => s.text === '4.4s')).toMatchObject({ color: 'planMode' })
  })

  test('a finished agent\'s time is colored as a running one\'s', () => {
    expect(segs().find(s => s.text === '   1m12s')).toMatchObject({ color: 'planMode' })
  })
})

describe('rate limits', () => {
  const segs = (change?: (s: ReturnType<typeof busyTree>) => void) => {
    const s = busyTree()
    change?.(s)
    return layout(s, UI, { cols: 56, now: NOW, frame: 0, animate: false }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
  }

  test('the share and its bar are a traffic light; the reset is a time, in the time color', () => {
    const all = segs()
    expect(all.find(x => x.text === 'session')).toMatchObject({ dim: true })
    expect(all.find(x => x.text === ' 23%')).toMatchObject({ color: 'success' })
    expect(all.find(x => x.text === '██')).toMatchObject({ color: 'success' })
    expect(all.find(x => x.text === '▎')).toMatchObject({ color: 'success' })
    expect(all.find(x => x.text === '16:24')).toMatchObject({ color: 'planMode' })
    expect(all.find(x => x.text === 'in 2h12m')).toMatchObject({ color: 'planMode' })
    expect(all.find(x => x.text === 'Friday 18:12')).toMatchObject({ color: 'planMode' })
    const high = segs(s => (s.main.limits = [{ kind: 'five_hour', percent: 63 }, { kind: 'seven_day', percent: 91 }]))
    expect(high.find(x => x.text === ' 63%')).toMatchObject({ color: 'warning' })
    expect(high.find(x => x.text === ' 91%')).toMatchObject({ color: 'error' })
  })

  test('with little room the word for resets goes first, then the countdown: the day and the time stay longest', () => {
    const all = (cols: number) => draw(cols, undefined, HU).find(l => l.startsWith('összes'))
    expect(all(78)).toMatch(/ újraindul péntek 18:12 · 2n4ó múlva$/)
    expect(all(56)).toMatch(/ péntek 18:12 · 2n4ó múlva$/)
    expect(all(44)).toMatch(/ péntek 18:12$/)
  })

  test('the narrow view names the windows 5h and 7d, as times', () => {
    const narrow = layout(busyTree(), UI, { cols: 36, now: NOW, frame: 0, animate: false })
    const segsN = narrow.flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    expect(segsN.find(x => x.text === '5h')).toMatchObject({ color: 'planMode' })
    expect(segsN.find(x => x.text === '7d')).toMatchObject({ color: 'planMode' })
    // narrow: the word `resets` goes, the time and the countdown stay
    expect(narrow.map(lineOf).join('\n')).toMatch(/5h █▍░░░░ 23% +16:24 · in 2h12m/)
    expect(narrow.map(lineOf).join('\n')).toMatch(/7d ██▌░░░ 41% +Friday 18:12 · in 2d4h/)
  })

  test('a limit with no reset time shows its share alone; none at all leaves the rows out', () => {
    const plain = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(plain.some(l => l.startsWith('session'))).toBe(true)
    const noReset = segs(s => (s.main.limits = [{ kind: 'five_hour', percent: 10 }]))
    expect(noReset.some(x => x.text.startsWith('in '))).toBe(false)
    const none = layout({ ...busyTree(), main: { ...busyTree().main, limits: undefined } }, UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(none.some(l => l.startsWith('session') || l.startsWith('all '))).toBe(false)
  })
})

describe('motion', () => {
  const rowsAt = (frame: number, animate = true, change?: (s: ReturnType<typeof busyTree>) => void) => {
    const s = busyTree()
    change?.(s)
    return layout(s, UI, { cols: 56, now: NOW, frame, animate })
  }
  const ctxRow = (rows: ReturnType<typeof rowsAt>) => {
    const row = rows.find(r => r.kind !== 'keys' && r.segs[0]?.text === 'ctx')
    return row && row.kind !== 'keys' ? row.segs : []
  }
  const lightAt = (segs: { text: string; color?: string }[]) => {
    let at = 0
    for (const seg of segs) {
      if (seg.color === 'cyanBright') return at
      at += width(seg.text)
    }
    return -1
  }

  test('a light cell runs left to right along a bar of three cells or more, then starts again at the left, its text unchanged', () => {
    const seen: number[] = []
    for (let f = 0; f < 8; f++) {
      const segs = ctxRow(rowsAt(f))
      expect(segs.map(x => x.text).join('').startsWith('ctx  ☁  ████▊░░░░░ 47%  ')).toBe(true)
      expect(segs.filter(x => x.color === 'cyanBright').map(x => x.text)).toEqual(['█'])
      seen.push(lightAt(segs))
    }
    // four full cells after "ctx  ☁  " (8 cells, where the limit bars start): 8, 9, 10, 11, then from the left again, never back
    expect(seen).toEqual([8, 9, 10, 11, 8, 9, 10, 11])
  })

  test('a bar with fewer than three full cells stays still', () => {
    const segs = ctxRow(rowsAt(2, true, s => (s.main.contextPercent = 25)))
    expect(segs.some(x => x.color === 'cyanBright' || x.color === 'blueBright')).toBe(false)
  })

  test('nothing moves without motion; idle, the bars still shimmer and the light still runs on the tree lines (as the user asked)', () => {
    expect(ctxRow(rowsAt(2, false)).some(x => x.color === 'cyanBright')).toBe(false)
    expect(hasLiveCell(rowsAt(2, false))).toBe(false)
    const idle = (s: ReturnType<typeof busyTree>) => {
      s.main.isBusy = false
      s.agents = s.agents.map(a => (a.state === 'running' || a.state === 'waiting' ? { ...a, state: 'done' as const } : a))
    }
    expect(ctxRow(rowsAt(2, true, idle)).some(x => x.color === 'cyanBright' && x.live)).toBe(true)
    expect(hasLiveCell(rowsAt(2, true, idle))).toBe(true)
    const lit = rowsAt(2, true, idle).flatMap(r => (r.kind === 'keys' ? [] : r.segs)).filter(x => x.color === 'whiteBright')
    expect(lit).toHaveLength(1)
    // with no bar to shimmer, the moving lines alone keep an idle pane redrawing, at the light's rest too
    const still = (s: ReturnType<typeof busyTree>) => {
      idle(s)
      s.main.contextPercent = 6
      s.main.limits = []
    }
    for (const frame of [0, 1, 2, 30]) expect(hasLiveCell(rowsAt(frame, true, still)), `frame ${frame}`).toBe(true)
    expect(hasLiveCell(rowsAt(2, false, still))).toBe(false)
  })

  test('the limit bars shimmer too, a shade lighter than their traffic-light color', () => {
    const high = (s: ReturnType<typeof busyTree>) => {
      s.main.limits = [{ kind: 'five_hour', percent: 63 }, { kind: 'seven_day', percent: 91 }]
    }
    const rows = rowsAt(1, true, high)
    const row = (label: string) => {
      const r = rows.find(x => x.kind !== 'keys' && x.segs[0]?.text === label)
      return r && r.kind !== 'keys' ? r.segs : []
    }
    expect(row('session').filter(x => x.live).map(x => x.color)).toEqual(['yellowBright'])
    expect(row('all').filter(x => x.live).map(x => x.color)).toEqual(['redBright'])
    // 23% of 10 cells is two full cells: no light
    expect(rowsAt(1, true).some(x => x.kind !== 'keys' && x.segs[0]?.text === 'session' && x.segs.some(y => y.live))).toBe(false)
  })

  test('a drawing with no bar of three full cells holds no light, so idle ticks rest', () => {
    const low = (s: ReturnType<typeof busyTree>) => {
      s.main.contextPercent = 6
      s.main.limits = [{ kind: 'five_hour', percent: 3 }]
      s.agents = []
    }
    expect(hasLiveCell(rowsAt(0, true, low))).toBe(false)
  })

  test('main and the trunk are drawn in the light trunk color', () => {
    const rows = rowsAt(0, false)
    const mainRow = rows.find(r => r.kind === 'press' && r.key === 'main')
    expect(mainRow?.kind === 'press' ? mainRow.segs[0] : undefined).toMatchObject({ text: 'main', color: 'cyanBright', bold: true })
    const guides = rows.flatMap(r => (r.kind !== 'keys' && /^[│├└]/.test(r.segs[0]?.text ?? '') ? [r.segs[0]!] : []))
    expect(guides.length > 5).toBe(true)
    for (const g of guides) expect(g, g.text).toMatchObject({ color: 'cyanBright' })
  })

  test('a light runs down the trunk a row a frame, turning into each branch', () => {
    const litRows: string[] = []
    for (let f = 0; f < 5; f++) {
      const rows = rowsAt(f)
      const lit = rows.flatMap(r => (r.kind === 'keys' ? [] : r.segs.filter(x => x.color === 'whiteBright')))
      expect(lit.length).toBe(1)
      litRows.push(lit[0]!.text)
    }
    // main's command line, the first branch with its dash, its status and command lines, the next branch
    expect(litRows).toEqual(['│', '├─', '│', '│', '├─'])
  })
})

describe('agent detail lines', () => {
  const at = (cols: number, rows?: number) => layout(busyTree(), UI, { cols, rows, now: NOW, frame: 0, animate: false }).map(lineOf)

  test('a waiting agent shows its status and ctx on one line, its command below', () => {
    const s = busyTree()
    s.agents = s.agents.map(a => (a.id === 'w1' ? { ...a, activity: 'Bash cargo build', tokens: 40_000, window: 200_000 } : a))
    const text = layout(s, UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).join('\n')
    expect(text).toMatch(/│ {4}general-purpose · waiting +ctx ☀  █░░░░ 20%\n│ {4}Bash cargo build/)
  })

  test('the wide view keeps tokens and cost on the status line', () => {
    expect(at(78).join('\n')).toMatch(/│ {4}Explore +▁▂▃▆▇█  21k  ≈\$0\.04  ctx ☀  █▎░░░░░ 18%\n│ {4}Grep src\/auth\/\*\*/)
  })

  test('a short pane drops the command lines before the status lines', () => {
    const full = at(56).join('\n')
    expect(full).toContain('Grep src/auth/**')
    const tighter = at(56, 23).join('\n')
    expect(tighter).not.toContain('Grep src/auth/**')
    expect(tighter).toMatch(/│ {4}Explore +ctx ☀ /)
  })
})

describe('an empty pane', () => {
  test('says only that there are no subagents yet', () => {
    for (const cols of [36, 56, 78]) {
      const text = layout(emptyTree(NOW), UI, { cols, now: NOW, frame: 0, animate: false }).map(lineOf).join('\n')
      expect(text).toContain('   No subagents yet.')
      expect(text).not.toContain('shows up here live')
    }
  })
})

describe('the advisor block', () => {
  const at = (cols: number, change?: (s: ReturnType<typeof busyTree>) => void) => {
    const s = busyTree()
    change?.(s)
    return layout(s, UI, { cols, now: NOW, frame: 0, animate: false }).map(lineOf)
  }

  test('the wide view adds this turn, the longest and the total length', () => {
    const text = at(78).join('\n')
    expect(text).toContain('3 calls · main 2 · agents 1 · this turn 3')
    expect(text).toContain('avg 4.4s · max 5.2s · total 13s')
  })

  test('the narrow view keeps the name, the count and the timings short', () => {
    const text = at(36).join('\n')
    expect(text).toMatch(/◆ ▾Fable 5\.2 +3 calls/)
    expect(text).toMatch(/ {2}2m ago · 4\.1s +avg 4\.4s/)
  })

  test('says "on" while no source names the model, and "no calls yet" before the first call', () => {
    expect(at(56, s => (s.advisor.model = undefined))[4]).toMatch(/^◆ ▾advisor · on +3 calls/)
    const quiet = at(56, s => (s.advisor = { model: 'claude-fable-5-2', total: 0, calls: [] }))
    expect(quiet[4]).toMatch(/^◆ ▾Fable 5\.2 advisor +no calls yet$/)
    expect(quiet.join('\n')).not.toContain('  last: ')
  })

  test('shows "off" when it is switched off, with the calls made before', () => {
    const lines = at(56, s => (s.advisor = { ...s.advisor, model: undefined, off: true }))
    expect(lines[4]).toMatch(/^◆ ▾advisor · off +3 calls before$/)
    expect(lines.join('\n')).not.toContain('  last: ')
  })

  test('neither named nor called, it shows off, with the sign to turn it on, and gives way first', () => {
    expect(at(56, s => (s.advisor = { total: 0, calls: [] }))[4]).toBe('◆ ▾advisor · off')
    const short = layout({ ...busyTree(), advisor: { total: 0, calls: [] } }, UI, { cols: 56, rows: 14, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(short.some(l => l.startsWith('◆ '))).toBe(false)
  })

  test('the environment turning it off leaves no sign', () => {
    expect(at(56, s => {
      s.advisor = { ...s.advisor, model: undefined, off: true }
      s.choices = { ...s.choices, advisorLocked: true }
    })[4]).toMatch(/^◆ advisor · off/)
  })

  test('an agent that asked the advisor carries a ◆ with the count', () => {
    expect(at(56).join('\n')).toMatch(/├─ . Find auth handlers ◆1 +✎ ▾Haiku 5\.5/)
  })
})

describe('a limit past its reset', () => {
  test('says it resets now until a response brings the new window', () => {
    const s = busyTree()
    s.main.limits = [{ kind: 'five_hour', percent: 97, resetsAt: new Date(NOW - 60_000).toISOString() }]
    const line = layout(s, UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).find(l => l.startsWith('session')) ?? ''
    expect(line).toMatch(/^session .* 97% +resets now$/)
  })
})

describe('remembered limits', () => {
  test('are drawn with ~ until a response confirms them', () => {
    const s = busyTree()
    s.main.limitsEstimated = true
    const line = layout(s, UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).find(l => l.startsWith('session')) ?? ''
    expect(line).toMatch(/^session ██▎░+ ~23% +resets 16:24 · in 2h12m$/)
  })
})

describe('the language sign and its panel', () => {
  const rowsOf = (ui: TreeUi, cols = 56, rows?: number) => layout(busyTree(), ui, { cols, rows, now: NOW, frame: 0, animate: false })
  const segsOf = (row: Row | undefined) => (row && row.kind !== 'keys' ? row.segs : [])

  test('the title row ends in ▾ and the language code, which open the language panel', () => {
    const title = segsOf(rowsOf(UI)[0])
    const sign = title.filter(s => s.press !== undefined)
    expect(sign.map(s => s.text).join('')).toBe('▾en')
    expect(sign[0]).toMatchObject({ color: 'cyan', key: 'picker:lang', press: { kind: 'picker', id: 'lang' } })
    expect(sign[1]).toMatchObject({ key: 'picker:lang' })
    expect(lineOf(rowsOf(HU)[0]!).endsWith('▾hu')).toBe(true)
    expect(lineOf(rowsOf(UI, 36)[0]!)).toBe(`Agent Tree // Forge${' '.repeat(14)}▾en`)
  })

  test('the panel opens right under the header, framed, its title in the top edge', () => {
    const lines = rowsOf({ ...UI, picker: 'lang' }).map(lineOf)
    const top = lines.findIndex(l => l.startsWith('╭─ '))
    expect(top).toBe(12)
    expect(lines[top - 1]).toMatch(/^agents  model: ▾auto   effort: ▾auto$/)
    expect(lines[top]).toBe(`╭─ Choose language ${'─'.repeat(36)}╮`)
    expect(lines[top + 1]).toBe('│ English   Magyar   Čeština   Dansk   Deutsch         │')
    // the twelve wrap over lines of their own; × ends the last, the frame closes under it
    const bottom = lines.findIndex((l, i) => i > top && l.startsWith('╰'))
    expect(lines[bottom - 1]?.endsWith('× │')).toBe(true)
    expect(lines[bottom]).toBe(`╰${'─'.repeat(54)}╯`)
    expect(lines[bottom + 1]?.startsWith('───')).toBe(true)
    // cells, not characters: 日本語 takes six
    for (const l of lines.slice(top, bottom + 1)) expect(width(l), l).toBe(56)
  })

  test('the chosen language is colored; each option and × can be pressed', () => {
    const rows = rowsOf({ ...UI, picker: 'lang' })
    const segs = rows.flatMap(segsOf)
    expect(segs.find(s => s.text === 'English')).toMatchObject({ color: PICKED_COLOR, bold: true, press: { kind: 'choose', id: 'lang', value: 'en' }, key: 'choose:lang:en' })
    const magyar = segs.find(s => s.text === 'Magyar')
    expect(magyar).toMatchObject({ press: { kind: 'choose', id: 'lang', value: 'hu' }, key: 'choose:lang:hu' })
    expect(magyar?.color).toBeUndefined()
    expect(segs.find(s => s.text === '×')).toMatchObject({ press: { kind: 'close' }, key: 'close:lang' })
    const hu = rowsOf({ ...HU, picker: 'lang' }).flatMap(segsOf)
    expect(hu.find(s => s.text === 'Válassz nyelvet')).toBeDefined()
    expect(hu.find(s => s.text === 'Magyar')).toMatchObject({ color: PICKED_COLOR, bold: true })
  })

  test('options wrap onto as many lines as they need; × ends the last line, or takes one of its own', () => {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'].map(v => ({ value: v, label: v }))
    const lines = frameRows('lang', 'Choose effort', efforts, 'high', 36).map(lineOf)
    expect(lines).toEqual([
      `╭─ Choose effort ${'─'.repeat(18)}╮`,
      `│ low   medium   high   xhigh${' '.repeat(5)} │`,
      `│ max${' '.repeat(28)}× │`,
      `╰${'─'.repeat(34)}╯`,
    ])
    const full = frameRows('lang', 'Pick', [{ value: 'x', label: 'x'.repeat(31) }], undefined, 36).map(lineOf)
    expect(full[1]).toBe(`│ ${'x'.repeat(31)}  │`)
    expect(full[2]).toBe(`│ ${' '.repeat(31)}× │`)
    for (const line of [...lines, ...full]) expect(line.length).toBe(36)
  })

  test('a short pane makes room for the open panel from the tree and the header, never the title', () => {
    const lines = rowsOf({ ...UI, picker: 'lang' }, 56, 10).map(lineOf)
    expect(lines.length <= 10).toBe(true)
    expect(lines[0]?.startsWith('Agent Tree // Forge')).toBe(true)
    expect(lines[1]?.startsWith('● ▾Opus 5.5')).toBe(true)
    expect(lines[2]?.startsWith('ctx ')).toBe(true)
    expect(lines.some(l => l.startsWith('╭─ Choose language'))).toBe(true)
    expect(lines.some(l => l.startsWith('╰'))).toBe(true)
  })

  test('the help view has no panel, and explains the sign', () => {
    const text = rowsOf({ ...UI, picker: 'lang', view: 'help' }).map(lineOf).join('\n')
    expect(text).not.toContain('Choose language')
    expect(text).toContain("▾en  the pane's language; press to change")
  })
})

describe('in Hungarian', () => {
  const lines = draw(56, undefined, HU)
  const text = lines.join('\n')

  test('the header speaks Hungarian; model names, effort and the signs stay as they are', () => {
    expect(lines[2]).toContain('● ▾Opus 5.5 · ▾high')
    // the limit labels are wider in Hungarian ("munkamenet"): the bar starts where theirs do, "előző kör" gives way
    expect(lines[3]).toBe('ctx     ☁  ████▊░░░░░ 47%         94.0k / 200k  ▲ +23.7k')
    expect(lines[4]).toMatch(/^◆ ▾Fable 5\.2 advisor +3 hívás · main 2 · agentek 1$/)
    expect(lines[5]).toMatch(/^ {2}utolsó: main · 2p ezelőtt · 4,1mp +átl\. 4,4mp$/)
    expect(lines[7]).toMatch(/^munkamenet ██▎░+ 23% +újraindul 16:24 · 2ó12p múlva$/)
    // `összes`: the window counts every model's use; the day by its full name (the user's words)
    expect(lines[8]).toMatch(/^összes {5}████▏░+ 41% +péntek 18:12 · 2n4ó múlva$/)
    expect(lines[10]?.trimEnd()).toBe('csapat  Opus × 2  Haiku × 5  Sonnet × 2  ◆ × 3')
  })

  test('the tree, the log and the keys too', () => {
    expect(text).toMatch(/Find auth handlers ◆1 +✎ ▾Haiku 5\.5 · low +38mp/)
    expect(text).toContain('general-purpose · vár')
    expect(text).toContain('reviewer · hibával leállt')
    expect(text).toContain('└─ + 3 befejezett')
    expect(text).toMatch(/advisor {10}hívta: main +4,1mp/)
    expect(text).toMatch(/Run test suite +kész · 14 eszköz +1p12mp/)
    expect(lines[lines.length - 1]).toBe('f: befejezett  l: napló  o: beállítások  h: súgó')
  })

  test('a log entry an older version wrote keeps its own text', () => {
    expect(text).toContain('spawned · Haiku 5.5')
  })

  test('the empty pane and the narrow limits', () => {
    expect(layout(emptyTree(NOW), HU, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).join('\n')).toContain('   Még nincs subagent.')
    expect(draw(36, undefined, HU).join('\n')).toMatch(/5ó █▍░░░░ 23% +16:24 · 2ó12p múlva/)
  })

  test('every time, its word included, is in the time color', () => {
    const segs = layout(busyTree(), HU, { cols: 78, now: NOW, frame: 0, animate: true }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    const huTime = /^\s*(\d+ó)?\d+(p\d\dmp|p|mp)( ezelőtt)?$|^\s*\d+,\dmp$|^\d\d:\d\d$|^(\d+n)?\d+[óp]\d*p? múlva$|^P \d\d:\d\d$/
    const times = segs.filter(s => huTime.test(s.text))
    expect(times.length > 10).toBe(true)
    for (const t of times) expect(t, `"${t.text}"`).toMatchObject({ color: 'planMode' })
  })
})

describe('the session model and effort', () => {
  const segsOf = (change?: (s: ReturnType<typeof busyTree>) => void, ui: TreeUi = UI) => {
    const s = busyTree()
    change?.(s)
    const row = layout(s, ui, { cols: 56, now: NOW, frame: 0, animate: false })[2]
    return row && row.kind !== 'keys' ? row.segs : []
  }
  const line = (change?: (s: ReturnType<typeof busyTree>) => void) => segsOf(change).map(x => x.text).join('')

  test('the model and the effort are each led by a ▾ that opens their panel, as the language sign is', () => {
    const segs = segsOf()
    expect(line()).toMatch(/^● ▾Opus 5\.5 · ▾high +≈\$1\.84$/)
    expect(segs.find(x => x.text === 'Opus 5.5')).toMatchObject({ key: 'picker:model', press: { kind: 'picker', id: 'model' }, bold: true })
    expect(segs.filter(x => x.text === '▾').map(x => [x.key, x.color])).toEqual([
      ['picker:model', 'cyan'],
      ['picker:effort', 'cyan'],
    ])
    expect(segs.find(x => x.text === 'high')).toMatchObject({ key: 'picker:effort', press: { kind: 'picker', id: 'effort' } })
  })

  test('a switch the pane asked for shows pending until it has taken effect', () => {
    expect(line(s => (s.choices = { ...s.choices, pendingModel: 'sonnet[1m]' }))).toMatch(/^● ▾Opus 5\.5 → Sonnet 1M · ▾high/)
    expect(line(s => (s.choices = { ...s.choices, pendingEffort: 'medium' }))).toMatch(/^● ▾Opus 5\.5 · ▾high → med/)
  })

  test('a model a policy locks has no ▾; an unknown effort still opens its panel', () => {
    expect(line(s => (s.choices = { ...s.choices, modelLocked: true }))).toMatch(/^● Opus 5\.5 · ▾high/)
    const unknown = segsOf(s => (s.main.effort = undefined))
    expect(unknown.find(x => x.text === 'effort')).toMatchObject({ dim: true, key: 'picker:effort' })
  })

  test('the model panel offers what /model offers, the model in use colored, and says it becomes the default', () => {
    const lines = draw(56, undefined, { ...UI, picker: 'model' })
    const top = lines.findIndex(l => l.startsWith('╭─ Session model '))
    expect(top).toBe(12)
    const panel = lines.slice(top, lines.findIndex((l, i) => i > top && l.startsWith('╰')) + 1)
    expect(panel.join('\n')).toMatch(/Default {3}Sonnet {3}Opus {3}Haiku {3}Fable/)
    expect(panel.join('\n')).toMatch(/Sonnet 1M {3}Opus 1M {3}Fable 1M {3}Opus Plan/)
    expect(panel[panel.length - 2]).toBe(`│ also saved as the default for new sessions${' '.repeat(10)} │`)
    for (const l of panel) expect(l.length).toBe(56)
    const segs = layout(busyTree(), { ...UI, picker: 'model' }, { cols: 56, now: NOW, frame: 0, animate: false }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    expect(segs.find(x => x.text === 'Opus')).toMatchObject({ color: PICKED_COLOR, bold: true, key: 'choose:model:opus', press: { kind: 'choose', id: 'model', value: 'opus' } })
    expect(segs.find(x => x.text === 'Sonnet 1M')).toMatchObject({ key: 'choose:model:sonnet[1m]' })
    expect(segs.find(x => x.text === 'Sonnet 1M')?.color).toBeUndefined()
  })

  test('the effort panel offers the five levels, the one in use colored', () => {
    const lines = draw(56, undefined, { ...UI, picker: 'effort' })
    const top = lines.findIndex(l => l.startsWith('╭─ Session effort '))
    expect(lines[top + 1]).toBe(`│ low   medium   high   xhigh   max${' '.repeat(18)}× │`)
    const segs = layout(busyTree(), { ...UI, picker: 'effort' }, { cols: 56, now: NOW, frame: 0, animate: false }).flatMap(r => (r.kind === 'keys' ? [] : r.segs))
    expect(segs.find(x => x.text === 'high' && x.key === 'choose:effort:high')).toMatchObject({ color: PICKED_COLOR, bold: true })
  })

  test('in the smallest pane the biggest panel fits: the tree gives it room, the title, model and context stay', () => {
    for (const ui of [{ ...UI, picker: 'model' as const }, { ...HU, picker: 'model' as const }]) {
      const lines = draw(36, 10, ui)
      expect(lines.length <= 10).toBe(true)
      expect(lines[0]?.startsWith('Agent Tree // Forge')).toBe(true)
      expect(lines[1]?.startsWith('● ▾Opus 5.5')).toBe(true)
      expect(lines[2]?.startsWith('ctx ')).toBe(true)
      expect(lines[3]?.startsWith('╭─ ')).toBe(true)
      expect(lines[lines.length - 1]?.startsWith('╰')).toBe(true)
    }
  })

  test('names the /model aliases and reads a model id as one', () => {
    const w = wordsFor('en')
    expect(['default', 'opus', 'sonnet[1m]', 'opusplan', 'best', 'mystery'].map(a => modelChoiceLabel(a, w))).toEqual(['Default', 'Opus', 'Sonnet 1M', 'Opus Plan', 'Best', 'mystery'])
    expect(modelChoiceLabel('default', wordsFor('hu'))).toBe('Alapértelmezett')
    expect([aliasOf('claude-opus-5-5'), aliasOf('claude-sonnet-5-5[1m]'), aliasOf(undefined), aliasOf('gpt-x')]).toEqual(['opus', 'sonnet[1m]', undefined, undefined])
  })
})

describe('a pending switch', () => {
  test('fits every width in every language', () => {
    for (const cols of [36, 44, 56, 72, 120]) {
      for (const ui of [UI, HU]) {
        const s = busyTree()
        s.choices = { ...s.choices, pendingModel: 'sonnet[1m]', pendingEffort: 'medium' }
        for (const row of layout(s, ui, { cols, now: NOW, frame: 0, animate: false })) {
          expect(rowWidth(row) <= cols, `${cols}: ${lineOf(row)}`).toBe(true)
        }
      }
    }
  })
})

describe('the advisor and new subagents', () => {
  const rowsOf = (change?: (s: ReturnType<typeof busyTree>) => void, cols = 56, ui: TreeUi = UI) => {
    const s = busyTree()
    change?.(s)
    return layout(s, ui, { cols, now: NOW, frame: 0, animate: false })
  }
  const segs = (rows: Row[]) => rows.flatMap(r => (r.kind === 'keys' ? [] : r.segs))

  test('the advisor row is led by a ▾ that opens its panel; a pending switch shows', () => {
    const rows = rowsOf()
    expect(segs(rows).find(x => x.text === 'Fable 5.2')).toMatchObject({ key: 'picker:advisor', press: { kind: 'picker', id: 'advisor' } })
    expect(lineOf(rowsOf(s => (s.choices = { ...s.choices, pendingAdvisor: 'off' }))[4]!)).toMatch(/^◆ ▾Fable 5\.2 → Off advisor/)
  })

  test('the advisor panel offers Fable, Opus, Sonnet and Off, the one in use colored', () => {
    const rows = rowsOf(undefined, 56, { ...UI, picker: 'advisor' })
    const lines = rows.map(lineOf)
    const top = lines.findIndex(l => l.startsWith('╭─ Advisor '))
    expect(lines[top + 1]).toMatch(/^│ Fable {3}Opus {3}Sonnet {3}Off +× │$/)
    expect(segs(rows).find(x => x.key === 'choose:advisor:fable')).toMatchObject({ color: PICKED_COLOR, bold: true })
    const off = rowsOf(s => (s.advisor = { ...s.advisor, model: undefined, off: true }), 56, { ...UI, picker: 'advisor' })
    expect(segs(off).find(x => x.key === 'choose:advisor:off')).toMatchObject({ color: PICKED_COLOR })
  })

  test('the subagents row: auto, a choice, the narrow view, a model the environment forces', () => {
    expect(rowsOf().map(lineOf)[11]).toBe('agents  model: ▾auto   effort: ▾auto')
    const chosen = rowsOf(s => (s.choices = { ...s.choices, agentModel: 'haiku', agentEffort: 'low' }))
    expect(lineOf(chosen[11]!)).toBe('agents  model: ▾Haiku   effort: ▾low')
    expect(segs(chosen).find(x => x.text === 'Haiku')).toMatchObject({ bold: true, key: 'picker:agentModel', color: 'success' })
    expect(rowsOf(undefined, 36).map(lineOf)).toContain('agents ▾auto · ▾auto')
    const forced = rowsOf(s => (s.choices = { ...s.choices, agentModelForced: 'haiku' }))
    expect(lineOf(forced[11]!)).toMatch(/^agents {2}model: Haiku (5\.5 )?\(env\) {3}effort: ▾auto$/)
    expect(segs(forced).some(x => x.key === 'picker:agentModel')).toBe(false)
  })

  test('in Hungarian', () => {
    expect(rowsOf(undefined, 56, HU).map(lineOf)[11]).toBe('agentek  modell: ▾auto   effort: ▾auto')
  })

  test('the subagent panels: auto first, then the families /model offers, or the levels; each says it is for this session', () => {
    const model = rowsOf(undefined, 56, { ...UI, picker: 'agentModel' }).map(lineOf)
    const top = model.findIndex(l => l.startsWith('╭─ Model for new subagents '))
    expect(model[top + 1]).toMatch(/^│ auto {3}Sonnet {3}Opus {3}Haiku {3}Fable +× │$/)
    expect(model[top + 2]).toMatch(/^│ this session only, even over Claude's own pick +│$/)
    const effort = rowsOf(undefined, 56, { ...UI, picker: 'agentEffort' }).map(lineOf)
    const etop = effort.findIndex(l => l.startsWith('╭─ Effort for new subagents '))
    expect(effort[etop + 1]).toMatch(/^│ auto {3}low {3}medium {3}high {3}xhigh {3}max +× │$/)
    expect(segs(rowsOf(undefined, 56, { ...UI, picker: 'agentEffort' })).find(x => x.key === 'choose:agentEffort:auto')).toMatchObject({ color: PICKED_COLOR })
  })
})

describe('a running subagent', () => {
  const rowsOf = (change?: (s: ReturnType<typeof busyTree>) => void, cols = 56, ui: TreeUi = UI) => {
    const s = busyTree()
    change?.(s)
    return layout(s, ui, { cols, now: NOW, frame: 0, animate: false })
  }
  const agentRow = (rows: Row[], name: string) => rows.find(r => r.kind !== 'keys' && lineOf(r).includes(name))!

  test("an agent at work: ✎ opens its message panel, its model its model panel; the rest of its row, the gap included, its transcript", () => {
    const row = agentRow(rowsOf(), 'Find auth handlers')
    expect(row.kind).toBe('text')
    const segs = row.kind === 'keys' ? [] : row.segs
    const envelope = segs.findIndex(x => x.key === 'compose:a1')
    expect(envelope > 0).toBe(true)
    for (const seg of segs.slice(0, envelope)) expect(seg, `"${seg.text}"`).toMatchObject({ key: 'agent:a1', press: { kind: 'agent', id: 'a1' } })
    expect(segs[envelope]).toMatchObject({ text: '✎ ', press: { kind: 'compose', agentId: 'a1' } })
    expect(segs.filter(x => x.text === '▾').map(x => x.key)).toEqual(['picker:runModel:a1'])
    expect(segs.find(x => x.text === 'Haiku 5.5')).toMatchObject({ press: { kind: 'picker', id: 'runModel', agentId: 'a1' } })
    expect(segs.find(x => x.text === 'low')?.press).toBeUndefined()
  })

  test('a finished agent has ✎ (a message resumes it) but no model sign', () => {
    const row = agentRow(rowsOf(), 'Run test suite')
    const segs = row.kind === 'keys' ? [] : row.segs
    expect(segs.some(x => x.key === 'compose:t1')).toBe(true)
    expect(lineOf(row)).not.toContain('▾')
  })

  test('a switch shows its target until a request has gone with it', () => {
    const line = lineOf(agentRow(rowsOf(s => (s.choices = { ...s.choices, runModels: { a1: 'sonnet' } })), 'Find auth handlers'))
    expect(line).toMatch(/Find auth handlers ◆1 +✎ ▾→Sonnet · low +38s$/)
    const landed = lineOf(agentRow(rowsOf(s => {
      s.choices = { ...s.choices, runModels: { a1: 'sonnet' } }
      s.agents = s.agents.map(a => (a.id === 'a1' ? { ...a, model: 'claude-sonnet-5-5' } : a))
    }), 'Find auth handlers'))
    expect(landed).toMatch(/Find auth handlers ◆1 +✎ ▾Sonnet 5\.5 · low +38s$/)
  })

  test("its panel: the agent's name in the title, auto first, what it runs on now colored, the cost said", () => {
    const rows = rowsOf(s => (s.choices = { ...s.choices, runModels: { a1: 'opus' } }), 56, { ...UI, picker: 'runModel', pickerFor: 'a1' })
    const lines = rows.map(lineOf)
    const top = lines.findIndex(l => l.startsWith('╭─ Find auth handlers · model '))
    expect(lines[top + 1]).toMatch(/^│ auto {3}Sonnet {3}Opus {3}Haiku {3}Fable +× │$/)
    expect(lines[top + 2]).toMatch(/^│ from its next request; context re-read at new price +│$/)
    expect(rows.flatMap(r => (r.kind === 'keys' ? [] : r.segs)).find(x => x.key === 'choose:runModel:opus')).toMatchObject({ color: PICKED_COLOR })
    expect(rowsOf(undefined, 56, { ...HU, picker: 'runModel', pickerFor: 'a1' }).map(lineOf).join('\n')).toContain('következő kéréstől; kontextus új áron újraolvasva')
  })

  test('the narrow view keeps the sign, the times in one column', () => {
    const lines = rowsOf(undefined, 36).map(lineOf).filter(l => /^├─ |^└─ /.test(l) && !l.includes('finished'))
    expect(lines.join('\n')).toMatch(/Find auth h\S*… ◆1 ✎▾H5\.5 lo +38s/)
    expect(new Set(lines.map(l => l.trimEnd().length)).size).toBe(1)
  })
})

describe('a message to a subagent', () => {
  const rowsOf = (ui: TreeUi, cols = 56, rows?: number, draft?: string) =>
    layout(busyTree(), ui, { cols, rows, now: NOW, frame: 0, animate: false, ...(draft ? { draft } : {}) })
  const segsOf = (rows: Row[]) => rows.flatMap(r => (r.kind === 'keys' ? [] : r.segs))

  test('its panel opens at the foot of the pane, in the keys\' place: the title, effort and its levels, the field', () => {
    const rows = rowsOf({ ...UI, compose: 'a1' })
    const lines = rows.map(lineOf)
    const top = lines.findIndex(l => l.startsWith('╭─ ✎ Message to Find auth handlers '))
    expect(top > 0).toBe(true)
    // nothing under it but the panel: no keys row; a separator parts it from the log above
    expect(lines.slice(top)).toHaveLength(6)
    expect(lines[top - 1]).toBe('─'.repeat(56))
    expect(lines[top - 2]).toMatch(/^\d\d:\d\d /)
    expect(lines[top + 1]).toMatch(/^│ effort: auto {3}low {3}medium {3}high {3}xhigh {3}max +× │$/)
    // the hint in the bottom edge, in the frame's color, not bold as the title is
    expect(lines[top + 2]).toMatch(/^╰─ Type your message below ─+╯$/)
    // under the frame the field, the pane's width, three lines, its label before it: the engine sizes
    // a focused field to the pane's whole width, and only a field of several lines scrolls and takes Up and Down
    expect(rows[top + 3]).toMatchObject({ kind: 'input', key: 'message:a1', agentId: 'a1', label: 'message', lines: 3, room: 47 })
    expect(lines[top + 3]).toBe(`message: ${' '.repeat(47)}`)
    expect(rows[top + 4]).toMatchObject({ kind: 'text', covered: true })
    expect(rows[top + 5]).toMatchObject({ kind: 'text', covered: true })
    // the label is five cells or more: the engine's "shift+⏎ new line" stays off in the default 56 columns
    for (const l of LANGS) expect(width(wordsFor(l.code).messageLabel) >= 5, l.code).toBe(true)
    // the key the focus is moved onto when the panel opens is the field's own
    expect(fieldKey('a1')).toBe('message:a1')
    expect(rows[top + 3]).not.toHaveProperty('hint')
    const bottom = rows[top + 2]
    const hint = (bottom?.kind === 'keys' ? [] : bottom?.segs ?? []).find(x => x.text.startsWith('Type your'))
    expect(hint).toMatchObject({ color: TITLE_COLOR })
    expect(hint?.dim).toBeUndefined()
    expect(hint?.bold).toBeUndefined()
    // in Hungarian, as the user worded it
    const hu = rowsOf({ ...HU, compose: 'a1' })
    expect(hu.map(lineOf).join('\n')).toMatch(/╰─ Írd be alább az üzenetet ─+╯/)
    expect(hu.find(r => r.kind === 'input')).toMatchObject({ kind: 'input', label: 'üzenet', lines: 3, room: 48 })
    // a narrow pane cuts the hint, the edge still closing
    const narrow = rowsOf({ ...HU, compose: 'a1' }, 36).map(lineOf)
    expect(narrow.at(-4)).toMatch(/^╰─ Írd be alább az üzenetet ─+╯$/)
    expect(lines.join('\n')).not.toContain('help')
    for (const row of rows) expect(rowWidth(row) <= 56, lineOf(row)).toBe(true)
    // the tree and the header stay above it
    expect(lines.join('\n')).toContain('Find auth handlers ◆1')
    expect(lines[0]?.startsWith('Agent Tree // Forge')).toBe(true)
  })

  test('auto is colored until an effort is chosen; the agent\'s pin shows; each level and × can be pressed', () => {
    const segs = segsOf(rowsOf({ ...UI, compose: 'a1' }))
    expect(segs.find(x => x.key === 'choose:msgEffort:auto')).toMatchObject({ color: PICKED_COLOR, press: { kind: 'choose', id: 'msgEffort', value: 'auto' } })
    expect(segs.find(x => x.key === 'choose:msgEffort:max')).toMatchObject({ press: { kind: 'choose', id: 'msgEffort', value: 'max' } })
    expect(segs.find(x => x.key === 'choose:msgEffort:max')?.color).not.toBe(PICKED_COLOR)
    expect(segs.find(x => x.key === 'close:msgEffort')).toMatchObject({ press: { kind: 'close' } })
    const chosen = segsOf(rowsOf({ ...UI, compose: 'a1', composeEffort: 'max' }))
    expect(chosen.find(x => x.key === 'choose:msgEffort:max')).toMatchObject({ color: PICKED_COLOR })
    const s = busyTree()
    s.choices = { ...s.choices, pins: { a1: 'high' } }
    const pinned = layout(s, { ...UI, compose: 'a1' }, { cols: 56, now: NOW, frame: 0, animate: false })
    expect(segsOf(pinned).find(x => x.key === 'choose:msgEffort:high')).toMatchObject({ color: PICKED_COLOR })
  })

  test('docked, it sits at the pane\'s very foot: the log, a separator, blank rows, the panel', () => {
    for (const rows of [44, 24]) {
      const lines = rowsOf({ ...UI, compose: 'a1' }, 56, rows).map(lineOf)
      expect(lines, `${rows} rows`).toHaveLength(rows)
      // the field's lines are the last rows, the frame's bottom edge right above them
      expect(lines[rows - 4]?.startsWith('╰')).toBe(true)
      const top = lines.findIndex(l => l.startsWith('╭─ ✎'))
      expect(top).toBe(rows - 6)
      // the separator closes what is above (the log, or the tree where the log has no room), then blank rows
      const parting = lines.slice(0, top).lastIndexOf('─'.repeat(56))
      expect(lines[parting - 1]?.trim()).not.toBe('')
      for (const blank of lines.slice(parting + 1, top)) expect(blank.trim()).toBe('')
      if (rows === 44) {
        expect(lines[parting - 1]).toMatch(/^\d\d:\d\d /)
        expect(top - parting - 1 > 0, 'room to spare at 44 rows').toBe(true)
      }
    }
    // the same with the placement named, as the pane gives it
    const docked = layout(busyTree(), { ...UI, compose: 'a1' }, { cols: 56, rows: 40, placement: 'dock', now: NOW, frame: 0, animate: false })
    expect(docked).toHaveLength(40)
  })

  test('inline the frame fits the tree: no blank rows, the separator still parts it from the log', () => {
    const lines = layout(busyTree(), { ...UI, compose: 'a1' }, { cols: 56, rows: 44, placement: 'inline', now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(lines.length < 44).toBe(true)
    const top = lines.findIndex(l => l.startsWith('╭─ ✎'))
    expect(lines[top - 1]).toBe('─'.repeat(56))
    expect(lines[top - 2]).toMatch(/^\d\d:\d\d /)
  })

  test('to a finished agent the panel is the same: no note (the user\'s request)', () => {
    const lines = rowsOf({ ...UI, compose: 't1' }).map(lineOf)
    const top = lines.findIndex(l => l.startsWith('╭─ ✎ Message to Run test suite '))
    expect(top > 0).toBe(true)
    expect(lines[top + 2]).toMatch(/^╰─ Type your message below ─+╯$/)
    expect(lines.join('\n')).not.toContain('resumes')
  })

  test('the field starts from the draft', () => {
    const field = rowsOf({ ...UI, compose: 'a1' }, 56, undefined, 'look in lib/ too').find(r => r.kind === 'input')
    expect(field).toMatchObject({ value: 'look in lib/ too' })
    expect(rowsOf({ ...UI, compose: 'a1' }).find(r => r.kind === 'input')).not.toHaveProperty('value')
  })

  test('in a short pane the tree and the log make room; the title, model and context stay; the field two lines at least', () => {
    for (const [cols, rows] of [[36, 10], [56, 12], [56, 16]] as const) {
      const drawn = rowsOf({ ...UI, compose: 't1' }, cols, rows)
      const lines = drawn.map(lineOf)
      expect((drawn.find(r => r.kind === 'input') as { lines?: number } | undefined)?.lines ?? 0, `${cols} × ${rows}`).toBeGreaterThanOrEqual(2)
      expect(lines.length <= rows, `${cols} × ${rows}: ${lines.length}`).toBe(true)
      expect(lines[0]?.startsWith('Agent Tree // Forge')).toBe(true)
      expect(lines.some(l => l.startsWith('ctx '))).toBe(true)
      expect(lines.some(l => l.startsWith('╭─ ✎'))).toBe(true)
    }
  })

  test('every agent row leads its model with ✎, finished ones too; in Hungarian the panel speaks Hungarian', () => {
    const lines = rowsOf(UI).map(lineOf).filter(l => /^[├└]─ /.test(l) && !l.includes('finished'))
    for (const line of lines) expect(line, line).toContain('✎')
    const hu = rowsOf({ ...HU, compose: 't1' }).map(lineOf).join('\n')
    expect(hu).toContain('╭─ ✎ Üzenet: Run test suite')
    expect(hu).not.toContain('újraindítja')
  })

  test('the help view explains the sign', () => {
    expect(layout(busyTree(), { ...UI, view: 'help' }, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).join('\n')).toMatch(/✎ +message an agent; a finished one resumes/)
  })
})

describe('the further languages', () => {
  test('the language panel offers them all, each in its own name, and fits the narrowest pane', () => {
    expect(LANGS.map(l => l.code)).toEqual(['en', 'hu', 'cs', 'da', 'de', 'es', 'fr', 'it', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'sl', 'sr', 'fi', 'sv', 'tr', 'el', 'ja', 'ko', 'zh'])
    for (const cols of [36, 56]) {
      const rows = layout(busyTree(), { ...UI, picker: 'lang' }, { cols, now: NOW, frame: 0, animate: false })
      const text = rows.map(lineOf).join('\n')
      for (const l of LANGS) expect(text, l.name).toContain(l.name)
      for (const row of rows) expect(rowWidth(row) <= cols, lineOf(row)).toBe(true)
    }
  })

  test('each speaks in its sign and its words', () => {
    for (const l of LANGS) {
      const lines = draw(56, undefined, { ...UI, lang: l.code })
      expect(lines[0]?.endsWith(`▾${l.code}`), l.code).toBe(true)
      expect(lines[0]?.startsWith('Agent Tree // Forge'), l.code).toBe(true)
    }
    expect(draw(56, undefined, { ...UI, lang: 'de' }).join('\n')).toContain('Team  Opus × 2')
    expect(draw(56, undefined, { ...UI, lang: 'ja' }).join('\n')).toContain('チーム  Opus × 2')
    expect(draw(56, undefined, { ...UI, lang: 'zh' }).join('\n')).toMatch(/Find auth handlers ◆1 +✎ ▾Haiku 5\.5 · low +38秒/)
  })

  test('their times: units, ago and in, days and dates', () => {
    const de = wordsFor('de')
    expect(de.ago('2min')).toBe('vor 2min')
    expect(de.date(10, 26)).toBe('26. Nov.')
    expect(wordsFor('fr').date(10, 26)).toBe('26 nov.')
    expect(wordsFor('ja').date(10, 26)).toBe('11月26日')
    expect(wordsFor('ko').in('2시간12분')).toBe('2시간12분 후')
    expect(wordsFor('tr').ago('2dk')).toBe('2dk önce')
    expect(wordsFor('pl').tools(2)).toBe('2 narzędzia')
    expect(wordsFor('pl').tools(5)).toBe('5 narzędzi')
    expect(wordsFor('pl').tools(22)).toBe('22 narzędzia')
    expect(wordsFor('cs').tools(3)).toBe('3 nástroje')
    expect(wordsFor('cs').tools(22)).toBe('22 nástrojů')
  })
})

describe('a language panel too tall for its pane', () => {
  test('names the languages by their codes, and fits', () => {
    const rows = layout(busyTree(), { ...UI, picker: 'lang' }, { cols: 36, rows: 10, now: NOW, frame: 0, animate: false })
    const lines = rows.map(lineOf)
    expect(lines.length <= 10).toBe(true)
    const panel = lines.join('\n')
    expect(panel).toContain('en   hu   cs')
    expect(panel).not.toContain('Magyar')
    for (const row of rows) expect(rowWidth(row) <= 36, lineOf(row)).toBe(true)
    // where the names fit, the names: 56 columns hold them in ten rows, the tree giving its room
    const wide = draw(56, 10, { ...UI, picker: 'lang' })
    expect(wide.length <= 10).toBe(true)
    expect(wide.join('\n')).toContain('Magyar')
  })
})

describe('the options', () => {
  const linesWith = (o: { logRows?: number; limits?: { warn: number; alert: number } }, cols = 56) =>
    layout(busyTree(), UI, { cols, now: NOW, frame: 0, animate: false, ...o }).map(lineOf)
  const logLines = (lines: string[]) => lines.filter(l => /^\d\d:\d\d /.test(l))

  test('log rows: five by default, as many as asked, none at 0; the narrow view at most one', () => {
    expect(logLines(linesWith({}))).toHaveLength(5)
    expect(logLines(linesWith({ logRows: 2 }))).toHaveLength(2)
    expect(logLines(linesWith({ logRows: 0 }))).toHaveLength(0)
    expect(linesWith({ logRows: 0 }).join('\n')).not.toContain('called by main')
    expect(linesWith({ logRows: 5 }, 36).filter(l => / 14:\d\d$/.test(l))).toHaveLength(1)
  })

  test('limit thresholds: where the bars turn yellow and red', () => {
    const colorOf = (label: string, limits?: { warn: number; alert: number }) => {
      const row = layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: false, ...(limits ? { limits } : {}) }).find(
        r => r.kind !== 'keys' && r.segs[0]?.text === label,
      )
      const segs = row && row.kind !== 'keys' ? row.segs : []
      return segs.find(x => /%$/.test(x.text))?.color
    }
    // 23% and 41% by default: both green
    expect([colorOf('session'), colorOf('all')]).toEqual(['success', 'success'])
    expect([colorOf('session', { warn: 20, alert: 30 }), colorOf('all', { warn: 20, alert: 30 })]).toEqual(['warning', 'error'])
  })
})

describe('the line above the prompt', () => {
  const lineText = (parts: ReturnType<typeof bandLine>) => parts.map(p => p.text).join(BAND_GAP)

  test("is built as token-weather's: a colored lead, a bold count, plain counts, the signs in runs, a dim tail", () => {
    const parts = bandLine(busyTree(), 120, { frame: 0, animate: true })
    expect(parts.map(p => p.text)).toEqual(['⠋ Opus 5.5', '2 running', '1 waiting · 4 done · 1 failed', parts[3]!.text, '◆3 · ≈$1.84'])
    expect(parts[0]!.style).toEqual({ color: 'claude' })
    expect(parts[1]!.style).toEqual({ bold: true })
    expect(parts[2]!.style).toEqual({})
    expect(parts[4]!.style).toEqual({ dimColor: true })
    const signs = parts[3]!
    expect(signs.runs?.map(r => r.text).join('')).toBe(signs.text)
    expect(signs.text).toContain('●●')
    expect(signs.text).toContain('‖')
    expect(signs.text).toContain('✗')
    expect(signs.runs?.find(r => r.text.includes('●'))?.style).toEqual({ color: 'success' })
    expect(signs.runs?.find(r => r.text.includes('✗'))?.style).toEqual({ color: 'error' })
  })

  test('gives way from the end as the line narrows: the signs, the tail, the counts', () => {
    const at = (cols: number) => bandLine(busyTree(), cols, { frame: 0, animate: true })
    for (const cols of [24, 36, 44, 56, 72, 120]) expect(width(lineText(at(cols))) <= cols || at(cols).length === 1, `${cols}`).toBe(true)
    expect(lineText(at(70))).toBe('⠋ Opus 5.5  2 running  1 waiting · 4 done · 1 failed  ◆3 · ≈$1.84')
    expect(lineText(at(56))).toBe('⠋ Opus 5.5  2 running  1 waiting · 4 done · 1 failed')
    expect(lineText(at(30))).toBe('⠋ Opus 5.5  2 running')
  })

  test('idle with no agents: the model and idle, in the pane language too', () => {
    const quiet = { ...emptyTree(NOW), main: { ...emptyTree(NOW).main, model: 'claude-sonnet-5-5' } }
    expect(lineText(bandLine(quiet, 80, { frame: 0, animate: true }))).toBe('○ Sonnet 5.5  idle')
    expect(lineText(bandLine(busyTree(), 56, { frame: 0, animate: false, lang: 'hu' }))).toMatch(/^● Opus 5\.5  2 fut  1 vár · 4 kész · 1 hibás/)
  })
})

describe('workflow runs', () => {
  const rowsOf = (ui: TreeUi = UI, cols = 56, rows?: number, s = workflowTree()): Row[] => layout(s, ui, { cols, rows, now: NOW, frame: 2, animate: true })
  const segOf = (row: Row | undefined, text: string) => (row && row.kind !== 'keys' ? row.segs.find(x => x.text === text) : undefined)

  test('a run is one row: its name, its counts and its time; its description under it; pressing it opens it', () => {
    const rows = rowsOf()
    const lines = rows.map(lineOf)
    const i = lines.findIndex(l => l.includes('▣ review-changes'))
    // when it started, beside its name, in the time color (two runs of one workflow told apart)
    expect(lines[i]).toMatch(/^├─ ▣ review-changes  14:10 +× 6  4✓ 1⠹ 1✗ +1m42s$/)
    expect(segOf(rows[i], '14:10')).toMatchObject({ color: TIME_COLOR })
    expect(rows[i]).toMatchObject({ kind: 'press', key: 'run:wf_review', press: { kind: 'run', id: 'wf_review' } })
    // its own line already beside its description: the tree's line does not break before its first agent
    expect(lines[i + 1]).toBe('│  │ Review changed files across dimensions')
    // the sign is a node the tree branches from: in the trunk's color, as its lines (the user's request)
    expect(segOf(rows[i], '▣')).toEqual({ text: '▣', color: TRUNK_COLOR })
  })

  test('closed: its agents at work and its failed one show, the finished ones only in its counts', () => {
    const lines = rowsOf().map(lineOf)
    const i = lines.findIndex(l => l.includes('▣ review-changes'))
    expect(lines[i + 2]).toMatch(/^│  ├─ ⠹ verify:auth\.ts +Haiku 5\.5 · low +12s$/)
    expect(lines[i + 3]).toMatch(/^│  │    Grep src\/auth\/\*\*/)
    expect(lines[i + 4]).toMatch(/^│  └─ ✗ verify:db\.ts +Haiku 5\.5 · low +31s$/)
    expect(lines[i + 5]).toMatch(/^│       ended with error/)
    expect(lines.some(l => l.includes('review:api'))).toBe(false)
    // the run that ended well folds as one, not its three agents: the three old explorers and it
    expect(lines.some(l => /^[├└]─ ▣ lint-sweep/.test(l))).toBe(false)
    expect(lines.some(l => /^└─ \+ 4 finished/.test(l))).toBe(true)
  })

  test("a run's agent takes no message and no switch, opens nothing, and names no `wf`", () => {
    const rows = rowsOf()
    const row = rows.find(r => lineOf(r).includes('verify:auth.ts'))!
    expect(row.kind).toBe('text')
    expect(row.kind !== 'keys' && row.segs.some(x => x.press !== undefined)).toBe(false)
    expect(lineOf(row)).not.toMatch(/[✎▾]/)
    expect(rows.map(lineOf).join('\n')).not.toMatch(/\bwf\b/)
    // an agent at work outside any run keeps its signs
    expect(rows.map(lineOf).find(l => l.includes('Find auth handlers'))).toMatch(/✎ ▾Haiku 5\.5/)
  })

  test('opened, all of its agents show; `f` shows every run, the finished one too', () => {
    const open = rowsOf({ ...UI, openRuns: ['wf_review'] }).map(lineOf)
    for (const x of ['api', 'ui', 'cli', 'docs']) expect(open.some(l => l.includes(`review:${x}`)), x).toBe(true)
    expect(open.some(l => /^[├└]─ ▣ lint-sweep/.test(l))).toBe(false)
    const all = rowsOf({ ...UI, showFinished: true }).map(lineOf)
    const lint = all.find(l => l.includes('▣ lint-sweep'))
    expect(lint).toMatch(/× 3  3✓ +40s$/)
    expect(all.some(l => l.includes('lint:3'))).toBe(true)
    expect(all.some(l => l.includes('review:docs'))).toBe(true)
  })

  test('a run pressed closed stays folded with `f` on; pressed open, it shows all with `f` off (its press wins)', () => {
    const shown = (ui: TreeUi) => rowsOf(ui).map(lineOf).some(l => l.includes('review:api'))
    expect(shown({ ...UI, showFinished: true })).toBe(true)
    expect(shown({ ...UI, showFinished: true, closedRuns: ['wf_review'] })).toBe(false)
    expect(shown({ ...UI, showFinished: false, openRuns: ['wf_review'] })).toBe(true)
    // the other run still follows `f`
    expect(rowsOf({ ...UI, showFinished: true, closedRuns: ['wf_review'] }).map(lineOf).some(l => l.includes('lint:3'))).toBe(true)
    expect(runOpen({ ...UI, showFinished: true }, 'wf_review')).toBe(true)
    expect(runOpen({ ...UI, showFinished: true, closedRuns: ['wf_review'] }, 'wf_review')).toBe(false)
  })

  test('a run that ended well keeps the trunk color in its sign; a failed one is red (and always shows)', () => {
    const s = workflowTree()
    const ended = rowsOf({ ...UI, showFinished: true }, 56, undefined, s)
    expect(segOf(ended.find(r => lineOf(r).includes('▣ lint-sweep')), '▣')).toEqual({ text: '▣', color: TRUNK_COLOR })
    const failed = { ...s, runs: s.runs!.map(r => (r.id === 'wf_lint' ? { ...r, end: 'failed' as const } : r)) }
    const rows = rowsOf(UI, 56, undefined, failed)
    expect(segOf(rows.find(r => lineOf(r).includes('▣ lint-sweep')), '▣')).toMatchObject({ color: 'error' })
  })

  test('the counts each in a color, none gray: done green, at work in the model color, failed red, waiting and stopped yellow', () => {
    const s = workflowTree()
    s.agents = s.agents.map(a => (a.id === 'm3' ? { ...a, state: 'waiting' as const } : a.id === 'm4' ? { ...a, state: 'stopped' as const } : a))
    const row = rowsOf(UI, 56, undefined, s).find(r => lineOf(r).includes('▣ review-changes'))
    const segs = row && row.kind !== 'keys' ? row.segs : []
    const colorOf = (text: string) => segs.find(x => x.text === text)
    expect(colorOf('2✓')).toMatchObject({ color: 'success' })
    expect(colorOf('1⠹')).toMatchObject({ color: 'success' })
    expect(colorOf('1‖')).toMatchObject({ color: 'warning' })
    expect(colorOf('1✗')).toMatchObject({ color: 'error' })
    expect(colorOf('1■')).toMatchObject({ color: 'warning' })
    for (const x of ['2✓', '1⠹', '1‖', '1✗', '1■']) expect(colorOf(x)?.dim, x).toBeUndefined()
    // the total in the run's own color, its sign's
    expect(colorOf('× 6')).toEqual({ text: '× 6', color: TRUNK_COLOR })
  })

  test('the narrow view: the counts with no spaces, no description, no start time', () => {
    const lines = rowsOf(UI, 36).map(lineOf)
    expect(lines.find(l => l.includes('▣ review'))).toMatch(/×6 4✓1⠹1✗ +1m42s$/)
    expect(lines.find(l => l.includes('▣ review'))).not.toMatch(/14:10/)
    expect(lines.some(l => l.includes('Review changed files'))).toBe(false)
  })

  test('a short pane keeps a run row over each of its agents it shows', () => {
    for (const rows of [16, 12, 10]) {
      const lines = rowsOf(UI, 56, rows).map(lineOf)
      expect(lines.length <= rows).toBe(true)
      if (lines.some(l => l.includes('verify:'))) expect(lines.some(l => l.includes('▣ review-changes')), `${rows} rows`).toBe(true)
    }
  })

  test("the log: a run's start and its end, by its name, in the pane's language", () => {
    const lines = rowsOf().map(lineOf)
    expect(lines.some(l => /▣ review-changes +started$/.test(l))).toBe(true)
    expect(lines.some(l => /▣ lint-sweep +done · × 3 +40s$/.test(l))).toBe(true)
    const hu = rowsOf(HU).map(lineOf)
    expect(hu.some(l => /▣ review-changes +elindult$/.test(l))).toBe(true)
    expect(hu.some(l => new RegExp(`▣ lint-sweep +${wordsFor('hu').legend.done} · × 3 +40mp$`).test(l))).toBe(true)
  })

  test('the line above the prompt: one sign for a run, not one for each of its agents', () => {
    const parts = bandLine(workflowTree(), 120, { frame: 0, animate: false })
    const signs = parts.find(p => p.runs)
    expect(signs?.text).toBe('✓✓✓●●‖✓✗▣▣')
    expect(signs?.runs?.at(-1)).toEqual({ text: '▣', style: {} })
    expect(signs?.runs?.at(-2)).toEqual({ text: '▣', style: { dimColor: true } })
  })

  test('every line in the tree carries a light of its own, as the trunk does (the user\'s rule)', () => {
    const lightsAt = (f: number, ui: TreeUi = { ...UI, openRuns: ['wf_review'] }) => {
      const out: Array<{ row: string; col: number; text: string }> = []
      for (const r of layout(workflowTree(), ui, { cols: 56, now: NOW, frame: f, animate: true })) {
        if (r.kind === 'keys') continue
        let col = 0
        for (const x of r.segs) {
          if (x.color === PULSE_COLOR) out.push({ row: lineOf(r), col, text: x.text })
          col += width(x.text)
        }
      }
      return out
    }
    // the run's own line, from beside its description down its agents: a row a frame, turning into each branch
    const inner = [0, 1, 2, 3].map(f => lightsAt(f).filter(l => l.col === 3))
    expect(inner.map(l => l.length)).toEqual([1, 1, 1, 1])
    expect(inner[0]![0]).toMatchObject({ text: '│' })
    expect(inner[0]![0]!.row).toMatch(/Review changed files/)
    expect(inner[1]![0]).toMatchObject({ text: '├─' })
    expect(inner[1]![0]!.row).toMatch(/verify:auth\.ts/)
    expect(inner[2]![0]).toMatchObject({ text: '│' })
    expect(inner[2]![0]!.row).toMatch(/Grep src/)
    expect(inner[3]![0]!.row).toMatch(/verify:db\.ts/)
    // the trunk keeps its own light at the same time, one each
    expect(lightsAt(0).filter(l => l.col === 0)).toHaveLength(1)
    // nothing moves without motion
    expect(layout(workflowTree(), UI, { cols: 56, now: NOW, frame: 0, animate: false }).some(r => r.kind !== 'keys' && r.segs.some(x => x.color === PULSE_COLOR))).toBe(false)
  })

  test('the start time gives way before the name is cut', () => {
    const s = workflowTree()
    s.runs = s.runs!.map(r => (r.id === 'wf_review' ? { ...r, name: 'review-every-change' } : r))
    const line = rowsOf(UI, 56, undefined, s).map(lineOf).find(l => l.includes('▣ review'))
    expect(line).toMatch(/▣ review-every-change +× 6/)
    expect(line).not.toMatch(/14:10/)
  })

  test('the help view links the repository, cut to fit a narrow pane, the link whole', () => {
    for (const cols of [36, 56, 78]) {
      const rows = layout(busyTree(), { ...UI, view: 'help' }, { cols, now: NOW, frame: 0, animate: false })
      const row = rows.find(r => lineOf(r).startsWith('GitHub '))
      const link = row && row.kind !== 'keys' ? row.segs.find(x => x.href !== undefined) : undefined
      expect(link, `${cols}`).toMatchObject({ href: 'https://github.com/JZO001/forge-agent-tree', color: TITLE_COLOR })
      if (cols >= 56) expect(lineOf(row!)).toBe('GitHub  https://github.com/JZO001/forge-agent-tree')
      expect(rowWidth(row!) <= cols).toBe(true)
    }
  })

  test('the help view names the sign', () => {
    const lines = layout(workflowTree(), { ...UI, view: 'help' }, { cols: 78, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(lines.some(l => l.startsWith('▣    a workflow run: its agents below it'))).toBe(true)
  })

  test('a workflow agent whose run is unknown (no run id) stays a row of its own, marked `wf`', () => {
    const s = busyTree()
    s.agents.push({ id: 'x1', description: 'stray wf', type: 'workflow-subagent', model: 'claude-haiku-5-5', state: 'running', since: NOW, startedAt: NOW - 5000, tools: 0, workflow: true })
    const lines = layout(s, UI, { cols: 56, now: NOW, frame: 2, animate: true }).map(lineOf)
    const i = lines.findIndex(l => l.includes('stray wf'))
    expect(lines[i]).toMatch(/✎ ▾Haiku 5\.5/)
    expect(lines[i + 1]).toMatch(/workflow-subagent wf/)
  })
})

describe("the state signs and the names in color (the user's request, no gray)", () => {
  const rowsOf = (s = workflowTree(), ui: TreeUi = { ...UI, openRuns: ['wf_review'] }) => layout(s, ui, { cols: 56, now: NOW, frame: 2, animate: true })
  const segsOf = (row: Row | undefined) => (row && row.kind !== 'keys' ? row.segs : [])
  const rowOf = (rows: Row[], name: string) => rows.find(r => lineOf(r).includes(name))

  test("an agent's state sign takes the run counts' colors: done green, stopped yellow, failed red, at work in its model's color", () => {
    const s = workflowTree()
    s.agents = s.agents.map(a => (a.id === 'm4' ? { ...a, state: 'stopped' as const } : a.id === 'm5' ? { ...a, state: 'starting' as const } : a))
    const rows = rowsOf(s)
    const sign = (name: string, text: string) => segsOf(rowOf(rows, name)).find(x => x.text === text)
    expect(sign('review:api', '✓')).toEqual({ text: '✓', color: 'success' })
    expect(sign('review:ui', '■')).toEqual({ text: '■', color: 'warning' })
    expect(sign('review:cli', '◌')).toEqual({ text: '◌', color: 'success' })
    expect(sign('verify:db.ts', '✗')).toEqual({ text: '✗', color: 'error' })
    expect(sign('verify:auth.ts', '⠹')).toEqual({ text: '⠹', color: 'success' })
    // the legend says the same
    const help = layout(busyTree(), { ...UI, view: 'help' }, { cols: 56, now: NOW, frame: 0, animate: false }).flatMap(segsOf)
    expect(help.find(x => x.text === '✓')).toMatchObject({ color: 'success' })
    expect(help.find(x => x.text === '■')).toMatchObject({ color: 'warning' })
  })

  test('the names, one row after the other, each in a color of its own; a finished one is not dimmed', () => {
    const rows = rowsOf()
    const names = ['review-changes', 'verify:auth.ts', 'verify:db.ts', 'review:api', 'review:ui', 'review:cli', 'review:docs']
    const colors = names.map(n => segsOf(rowOf(rows, n)).find(x => x.text === n)?.color)
    for (const c of colors) expect(c).toBeDefined()
    for (let i = 1; i < colors.length; i++) expect(colors[i], `${names[i - 1]} / ${names[i]}`).not.toBe(colors[i - 1])
    expect(segsOf(rowOf(rows, 'review:api')).find(x => x.text === 'review:api')?.dim).toBeUndefined()
    // none of them the pulse's white, so a light on the lines is never taken for a name
    for (const c of colors) expect(c).not.toBe('whiteBright')
  })
})

describe('the empty rows in the header (the user asked for them)', () => {
  const headOf = (rows?: number) => {
    const lines = layout(busyTree(), UI, { cols: 56, rows, now: NOW, frame: 0, animate: false }).map(lineOf)
    return lines.slice(0, lines.findIndex(l => l.startsWith('───')))
  }

  test('after the title, after the advisor, before the team; none first, last or two together', () => {
    const head = headOf()
    const blanks = head.map((l, i) => (l.trim() === '' ? i : -1)).filter(i => i >= 0)
    expect(blanks.map(i => head[i - 1]?.split(' ')[0])).toEqual(['Agent', '', 'all'])
    expect(head[blanks[2]! + 1]).toMatch(/^team /)
  })

  test('where the whole tree does not fit beside them, they give way first', () => {
    for (const rows of [40, 30]) expect(headOf(rows).filter(l => l.trim() === ''), `${rows} rows`).toHaveLength(3)
    for (const rows of [23, 16, 12]) expect(headOf(rows).filter(l => l.trim() === ''), `${rows} rows`).toHaveLength(0)
  })

  test('with no limits and no advisor, one empty row, not two, before the team', () => {
    const s = busyTree()
    s.main.limits = []
    s.advisor = { total: 0, calls: [], off: true }
    s.choices = { ...s.choices, advisorLocked: true }
    const lines = layout(s, UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf)
    const head = lines.slice(0, lines.findIndex(l => l.startsWith('───')))
    for (let i = 1; i < head.length; i++) expect(head[i]!.trim() === '' && head[i - 1]!.trim() === '', `${i}`).toBe(false)
  })
})

describe('the options page (plan 06)', () => {
  const OPTIONS: TreeUi = { ...UI, view: 'options' }
  const page = (ui: TreeUi = OPTIONS, cols = 56, rows?: number, settings?: Settings) =>
    layout(busyTree(), ui, { cols, rows, now: NOW, frame: 0, animate: false, ...(settings ? { settings } : {}) })
  const segsOf = (row: Row | undefined) => (row && row.kind !== 'keys' ? row.segs : [])
  const rowOf = (rows: Row[], label: string) => rows.find(r => lineOf(r).startsWith(label))

  test('each option a row, its value on the right, a line about it; the language by its name; the note; o goes back', () => {
    const lines = page().map(lineOf)
    expect(lines[0]).toBe('Agent Tree // Forge')
    expect(lines[1]).toBe('Options')
    expect(lines[2]).toBe('─'.repeat(56))
    expect(lines[3]).toMatch(/^Open on start +on$/)
    expect(lines[4]).toBe('  open the pane when an interactive session starts')
    expect(lines.find(l => l.startsWith('Width'))).toMatch(/^Width +− 56 \+$/)
    expect(lines.find(l => l.startsWith('Log rows'))).toMatch(/^Log rows +− 5 \+$/)
    expect(lines.find(l => l.startsWith('Limits: yellow from'))).toMatch(/− 50% \+$/)
    expect(lines.find(l => l.startsWith('Limits: red from'))).toMatch(/− 80% \+$/)
    expect(lines.find(l => l.startsWith('Advisor sound'))).toMatch(/^Advisor sound +off$/)
    expect(lines.find(l => l.startsWith('Auto-update'))).toMatch(/^Auto-update +on$/)
    expect(lines).toContain('  daily, from GitHub; marketplace installs only')
    // the language by its own name, not its code (the user's request)
    expect(lines.find(l => l.startsWith('Language'))).toMatch(/^Language +▾English$/)
    expect(lines.at(-2)).toBe("Saved in Claude Code's settings (/config), every session")
    expect(lines.at(-1)).toBe('o: back  h: help')
    for (const row of page()) expect(rowWidth(row) <= 56, lineOf(row)).toBe(true)
  })

  test('a press sets a value as /config would: on and off switch, a number steps, held to its bounds', () => {
    const rows = page()
    const press = (label: string, text: string) => segsOf(rowOf(rows, label)).find(x => x.text === text)?.press
    expect(press('Advisor sound', 'off')).toEqual({ kind: 'option', field: 'advisorSound', value: true })
    expect(press('Auto-update', 'on')).toEqual({ kind: 'option', field: 'autoUpdate', value: false })
    expect(press('Motion', 'on')).toEqual({ kind: 'option', field: 'animate', value: false })
    expect(press('Width', '−')).toEqual({ kind: 'option', field: 'columns', value: 52 })
    expect(press('Width', '+')).toEqual({ kind: 'option', field: 'columns', value: 60 })
    expect(press('Log rows', '+')).toEqual({ kind: 'option', field: 'logRows', value: 6 })
    // on in the chosen color; a bound's sign dim and still
    expect(segsOf(rowOf(rows, 'Motion')).find(x => x.text === 'on')).toMatchObject({ color: PICKED_COLOR, bold: true })
    const edge = page(OPTIONS, 56, undefined, { values: { ...DEFAULT_SETTINGS, logRows: 0, limitWarnAt: 75, limitAlertAt: 80 } })
    expect(segsOf(rowOf(edge, 'Log rows')).find(x => x.text === '−')).toEqual({ text: '−', dim: true })
    // red stays above yellow: yellow cannot reach it, red cannot go under it
    expect(segsOf(rowOf(edge, 'Limits: yellow from')).find(x => x.text === '+')).toEqual({ text: '+', dim: true })
    expect(segsOf(rowOf(edge, 'Limits: red from')).find(x => x.text === '−')).toEqual({ text: '−', dim: true })
  })

  test('an option a policy locks shows its value with no button', () => {
    const rows = page(OPTIONS, 56, undefined, { values: DEFAULT_SETTINGS, locked: ['advisorSound', 'columns'] })
    expect(segsOf(rowOf(rows, 'Advisor sound')).some(x => x.press !== undefined)).toBe(false)
    expect(lineOf(rowOf(rows, 'Width')!)).toMatch(/^Width +56$/)
    expect(segsOf(rowOf(rows, 'Motion')).some(x => x.press !== undefined)).toBe(true)
  })

  test('its ▾ opens the language panel on the page; a short pane drops the lines about the options first, then the note', () => {
    expect(page({ ...OPTIONS, picker: 'lang' }).map(lineOf).some(l => l.startsWith('╭─ '))).toBe(true)
    const short = page(OPTIONS, 56, 16).map(lineOf)
    expect(short.length <= 16).toBe(true)
    expect(short.some(l => l.startsWith('  open the pane'))).toBe(false)
    expect(short.some(l => l.startsWith('Advisor sound'))).toBe(true)
    expect(short.at(-1)).toBe('o: back  h: help')
  })

  test('it fits every width in every language, the language panel closed and open', () => {
    for (const cols of [36, 44, 56, 72, 120]) {
      for (const l of LANGS) {
        for (const ui of [{ ...OPTIONS, lang: l.code }, { ...OPTIONS, lang: l.code, picker: 'lang' as const }]) {
          for (const rows of [undefined, 40, 24, 16]) {
            const drawn = page(ui, cols, rows)
            for (const row of drawn) expect(rowWidth(row) <= cols, `${l.code} ${cols}: ${lineOf(row)}`).toBe(true)
            if (rows !== undefined && !ui.picker) expect(drawn.length <= rows, `${l.code} ${cols}×${rows}`).toBe(true)
          }
          // each option's name and the language's own name show
          const text = page(ui, cols).map(lineOf).join('\n')
          expect(text, `${l.code} ${cols}`).toContain(`▾${l.name}`)
        }
      }
    }
  })

  test('the keys row gains o: options; where the buttons do not fit, they show their keys alone', () => {
    expect(layout(busyTree(), UI, { cols: 56, now: NOW, frame: 0, animate: false }).map(lineOf).at(-1)).toBe('↵ open  f: finished  l: log  o: options  h: help')
    const narrow = layout(busyTree(), HU, { cols: 36, now: NOW, frame: 0, animate: false }).at(-1)!
    expect(lineOf(narrow)).toBe('f:   l:   o:   h: ')
    expect(narrow.kind === 'keys' && narrow.items.map(i => (isButton(i) ? i.press.kind : ''))).toEqual(['finished', 'log', 'options', 'help'])
  })

  test('the help says how to close the pane and open it again, and its keys reach the options', () => {
    const help = layout(busyTree(), { ...UI, view: 'help' }, { cols: 78, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(help).toContain('/tree close closes the pane; /tree opens it again')
    expect(help.at(-1)).toBe('o: options  h: back')
    const hu = layout(busyTree(), { ...HU, view: 'help' }, { cols: 78, now: NOW, frame: 0, animate: false }).map(lineOf)
    expect(hu).toContain('/tree close bezárja a panelt; /tree újra megnyitja')
  })
})
