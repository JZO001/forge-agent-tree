// The pane's words in each language it speaks: English, the default and the
// source, Hungarian, and the others (langs-eu.ts, langs-asia.ts,
// langs-nordic.ts, langs-south.ts, langs-slavic.ts). Model names, effort levels (low … max), `main`, `advisor`
// and the signs (ctx, ≈$, ◆) are Claude Code's own terms and stay as they are
// in every language.
import type { Lang } from '../types'
import { asianWords } from './langs-asia'
import { europeanWords } from './langs-eu'
import { nordicWords } from './langs-nordic'
import { slavicWords } from './langs-slavic'
import { southernWords } from './langs-south'

/** The pane's name, its top row; the same in every language. */
export const NAME = 'Agent Tree // Forge'

/** The languages the pane speaks, each in its own name, in the order the picker offers them. */
export const LANGS: readonly { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'hu', name: 'Magyar' },
  { code: 'cs', name: 'Čeština' },
  { code: 'da', name: 'Dansk' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'no', name: 'Norsk' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português' },
  { code: 'ro', name: 'Română' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'sr', name: 'Srpski' },
  { code: 'fi', name: 'Suomi' },
  { code: 'sv', name: 'Svenska' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
]

export function isLang(value: unknown): value is Lang {
  return LANGS.some(l => l.code === value)
}

export type Words = {
  lang: Lang
  /** Time units: `38s`, `1m12s`, `1h04m`, `2d4h`, and the decimal sign of `4.1s`. */
  units: { s: string; m: string; h: string; d: string; decimal: string }
  ago: (d: string) => string
  in: (d: string) => string
  now: string
  /** Sunday first, as `Date.getDay()` counts. */
  days: readonly string[]
  /** The same by their full names (`Friday`, `péntek`), where there is room. */
  daysLong: readonly string[]
  date: (month: number, day: number) => string
  lastTurn: string
  session: string
  /** The seven-day window's label: it counts every model's use (the user's word: `összes`). */
  allModels: string
  fiveHour: string
  sevenDay: string
  resets: string
  team: string
  off: string
  on: string
  calls: (n: number) => string
  callsBefore: (n: number) => string
  noCallsYet: string
  noCalls: string
  split: (main: number, agents: number) => string
  thisTurn: (n: number) => string
  lastCall: string
  avg: string
  max: string
  total: string
  starting: string
  waiting: string
  refused: string
  interrupted: string
  endedWithError: string
  failed: string
  idle: string
  tools: (n: number) => string
  intro: string
  more: (n: number) => string
  finished: (n: number) => string
  show: string
  keys: { finished: string; log: string; help: string; back: string; focusWide: string; focus: string; open: string; options: string }
  legend: {
    title: string
    running: string
    done: string
    failed: string
    stopped: string
    starting: string
    waiting: string
    idle: string
    context: string
    estimated: string
    delta: string
    effort: string
    cost: string
    advisor: readonly [string, string, string]
    lang: string
    pickers: string
    agents: string
    /** The `▣` line: a workflow run, its agents under it. */
    workflow: string
    /** How to close and open the pane from the prompt: `/tree close`, `/tree`. */
    commands: string
    keys: readonly [string, string, string]
  }
  glance: { running: (n: number) => string; waiting: (n: number) => string; done: (n: number) => string; failed: (n: number) => string }
  log: {
    resumed: string
    /** A workflow run started. */
    started: string
    spawned: (model: string) => string
    found: (model: string) => string
    calledBy: (who: string) => string
    context: (percent: number) => string
    compacted: string
    waiting: string
    done: (tools: number) => string
    interrupted: string
    refused: string
    error: string
    stopped: string
    failed: string
  }
  chooseLanguage: string
  sessionModel: string
  sessionEffort: string
  /** Under a session panel: the choice is saved as Claude Code's default too. */
  savedAsDefault: string
  /** The `default` model alias, as the model panel names it. */
  defaultModel: string
  /** In place of the effort while it is unknown. */
  effortWord: string
  advisorTitle: string
  offLabel: string
  auto: string
  agents: string
  modelLabel: string
  effortLabel: string
  forced: string
  agentModelTitle: string
  agentEffortTitle: string
  agentModelNote: string
  agentEffortNote: string
  runModelTitle: (who: string) => string
  runModelNote: string
  /** The message panel: its title, the field's hint, Enter's label, the note for a finished agent, the log text, the failure toast, the legend line. */
  messageTo: (who: string) => string
  messageHint: string
  /**
   * The field's label (`üzenet: `), five cells or more: a label that long keeps
   * the engine's ` · shift+⏎ new line` from the default 56-column pane.
   */
  messageLabel: string
  /** The options page: its title, the note under it, the language row, each option's name and a line about it. */
  options: {
    title: string
    note: string
    language: string
    labels: Record<OptionField, string>
    about: Record<OptionField, string>
  }
  messageLog: string
  messageFailed: (reason: string) => string
  messageLegend: string
  said: (text: string) => string
  switchFailed: (command: string, value: string) => string
  notApplied: (command: string, value: string) => string
  /** The mod's own update (plan 07): the toast after it installed a newer version, and the one when it could not, with the command to run by hand. */
  updated: (version: string) => string
  updateFailed: (version: string, command: string) => string
  command: {
    description: string
    closed: string
    opened: string
    waits: (reason: string) => string
    none: string
    failed: string
    drawFailed: string
  }
}

/** The mod's options (`userConfig` in plugin.json), as the options page lists them. */
export type OptionField = 'openOnStart' | 'animate' | 'columns' | 'logRows' | 'limitWarnAt' | 'limitAlertAt' | 'bandLine' | 'advisorSound' | 'autoUpdate'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const EN: Words = {
  lang: 'en',
  units: { s: 's', m: 'm', h: 'h', d: 'd', decimal: '.' },
  ago: d => `${d} ago`,
  in: d => `in ${d}`,
  now: 'now',
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  daysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  date: (month, day) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]} ${day}`,
  lastTurn: 'last turn',
  session: 'session',
  allModels: 'all',
  fiveHour: '5h',
  sevenDay: '7d',
  resets: 'resets ',
  team: 'team',
  off: ' · off',
  on: ' · on',
  calls: n => plural(n, 'call', 'calls'),
  callsBefore: n => `${plural(n, 'call', 'calls')} before`,
  noCallsYet: 'no calls yet',
  noCalls: 'no calls',
  split: (main, agents) => ` · main ${main} · agents ${agents}`,
  thisTurn: n => ` · this turn ${n}`,
  lastCall: '  last: ',
  avg: 'avg ',
  max: ' · max ',
  total: ' · total ',
  starting: ' · starting…',
  waiting: 'waiting',
  refused: 'refused',
  interrupted: 'interrupted',
  endedWithError: 'ended with error',
  failed: 'failed',
  idle: '○ idle',
  tools: n => plural(n, 'tool', 'tools'),
  intro: 'No subagents yet.',
  more: n => `+ ${n} more`,
  finished: n => `+ ${n} finished`,
  show: 'f: show',
  keys: { finished: 'finished', log: 'log', help: 'help', back: 'back', focusWide: 'ctrl+x ⇥ focus', focus: '⇥ focus', open: '↵ open', options: 'options' },
  legend: {
    title: 'Legend',
    running: 'running',
    done: 'done',
    failed: 'failed',
    stopped: 'stopped',
    starting: 'starting',
    waiting: 'waiting',
    idle: 'idle',
    context: 'share of the context window, as weather:',
    estimated: 'estimated until the first reply measures it',
    delta: 'the context grew or shrank over the last turn',
    effort: 'low med high xhigh max; narrow: lo md hi xh mx',
    cost: 'client-side estimate, not the bill',
    advisor: ['advisor call: a server-side tool; ◆2 on an', 'agent: it asked the advisor twice;', 'Claude decides when to call it'],
    lang: "the pane's language; press to change",
    pickers: 'and ▾xhigh: the model and the effort; press to change',
    agents: 'new subagents get these; this session only',
    workflow: 'a workflow run: its agents below it; press to show all',
    commands: '/tree close closes the pane; /tree opens it again',
    keys: ['ctrl+x tab: focus the pane', '↑ ↓ move · ↵ or click: open transcript', 'main row: back to the conversation'],
  },
  glance: { running: n => `${n} running`, waiting: n => `${n} waiting`, done: n => `${n} done`, failed: n => `${n} failed` },
  log: {
    resumed: 'resumed',
    started: 'started',
    spawned: model => `spawned · ${model}`,
    found: model => `found · ${model}`,
    calledBy: who => `called by ${who}`,
    context: p => `context ${p}%`,
    compacted: 'context compacted',
    waiting: 'waiting',
    done: tools => `done · ${plural(tools, 'tool', 'tools')}`,
    interrupted: 'interrupted',
    refused: 'refused',
    error: 'error',
    stopped: 'stopped',
    failed: 'failed',
  },
  chooseLanguage: 'Choose language',
  sessionModel: 'Session model',
  sessionEffort: 'Session effort',
  savedAsDefault: 'also saved as the default for new sessions',
  defaultModel: 'Default',
  effortWord: 'effort',
  advisorTitle: 'Advisor',
  offLabel: 'Off',
  auto: 'auto',
  agents: 'agents',
  modelLabel: 'model: ',
  effortLabel: 'effort: ',
  forced: '(env)',
  agentModelTitle: 'Model for new subagents',
  agentEffortTitle: 'Effort for new subagents',
  agentModelNote: "this session only, even over Claude's own pick",
  agentEffortNote: 'this session only; agents at work keep their own',
  runModelTitle: who => `${who} · model`,
  runModelNote: 'from its next request; context re-read at new price',
  messageTo: who => `Message to ${who}`,
  messageHint: 'Type your message below',
  messageLabel: 'message',
  options: {
    title: 'Options',
    note: 'Saved in Claude Code\'s settings (/config), every session',
    language: 'Language',
    labels: { openOnStart: 'Open on start', animate: 'Motion', columns: 'Width', logRows: 'Log rows', limitWarnAt: 'Limits: yellow from', limitAlertAt: 'Limits: red from', bandLine: 'Line above the prompt', advisorSound: 'Advisor sound', autoUpdate: 'Auto-update' },
    about: { openOnStart: 'open the pane when an interactive session starts', animate: 'the spinner, the bars\' light, the pulse on the tree', columns: 'the docked pane\'s columns, from its next opening', logRows: '0 hides the log', limitWarnAt: 'a limit bar turns yellow from this share', limitAlertAt: 'and red from this one', bandLine: 'while the pane is closed', advisorSound: 'macOS: a chime; Windows: two beeps; Linux: nothing', autoUpdate: 'daily, from GitHub; marketplace installs only' },
  },
  messageLog: 'message sent',
  messageFailed: reason => `${NAME}: the message was not delivered: ${reason}`,
  messageLegend: 'message an agent; a finished one resumes',
  said: text => `${NAME}: ${text}`,
  switchFailed: (command, value) => `${NAME}: /${command} ${value} did not run`,
  notApplied: (command, value) => `${NAME}: /${command} ${value} has not taken effect`,
  updated: version => `${NAME}: updated to ${version}; /reload-plugins or a restart loads it`,
  updateFailed: (version, command) => `${NAME}: could not update to ${version}; by hand: ${command}`,
  command: {
    description: `Show the ${NAME} pane; add "close" to hide it`,
    closed: `${NAME} closed.`,
    opened: `${NAME} opened.`,
    waits: reason => `${NAME} waits: ${reason}`,
    none: `${NAME}: no slash command could be registered; the pane still opens on start.`,
    failed: `${NAME}: the command failed; see claude --debug.`,
    drawFailed: `${NAME} could not draw this frame.`,
  },
}

const HU: Words = {
  lang: 'hu',
  units: { s: 'mp', m: 'p', h: 'ó', d: 'n', decimal: ',' },
  ago: d => `${d} ezelőtt`,
  in: d => `${d} múlva`,
  now: 'most',
  days: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'],
  daysLong: ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'],
  date: (month, day) => `${['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'][month]} ${day}.`,
  lastTurn: 'előző kör',
  session: 'munkamenet',
  allModels: 'összes',
  fiveHour: '5ó',
  sevenDay: '7n',
  resets: 'újraindul ',
  team: 'csapat',
  off: ' · ki',
  on: ' · be',
  calls: n => `${n} hívás`,
  callsBefore: n => `${n} hívás korábban`,
  noCallsYet: 'még nincs hívás',
  noCalls: 'nincs hívás',
  split: (main, agents) => ` · main ${main} · agentek ${agents}`,
  thisTurn: n => ` · e körben ${n}`,
  lastCall: '  utolsó: ',
  avg: 'átl. ',
  max: ' · max ',
  total: ' · össz. ',
  starting: ' · indul…',
  waiting: 'vár',
  refused: 'elutasította',
  interrupted: 'megszakítva',
  endedWithError: 'hibával leállt',
  failed: 'sikertelen',
  idle: '○ tétlen',
  tools: n => `${n} eszköz`,
  intro: 'Még nincs subagent.',
  more: n => `+ ${n} további`,
  finished: n => `+ ${n} befejezett`,
  show: 'f: mutat',
  keys: { finished: 'befejezett', log: 'napló', help: 'súgó', back: 'vissza', focusWide: 'ctrl+x ⇥ fókusz', focus: '⇥ fókusz', open: '↵ megnyit', options: 'beállítások' },
  legend: {
    title: 'Jelmagyarázat',
    running: 'fut',
    done: 'kész',
    failed: 'hiba',
    stopped: 'leállítva',
    starting: 'indul',
    waiting: 'vár',
    idle: 'tétlen',
    context: 'a kontextusablak telítettsége, időjárásként:',
    estimated: 'becslés, amíg az első válasz meg nem méri',
    delta: 'a kontextus nőtt vagy csökkent az előző körben',
    effort: 'low med high xhigh max; keskeny: lo md hi xh mx',
    cost: 'helyi becslés, nem a számla',
    advisor: ['advisor-hívás: szerveroldali eszköz; ◆2 egy', 'agentnél: kétszer kérdezte az advisort;', 'Claude dönti el, mikor hívja'],
    lang: 'a panel nyelve; megnyomva váltható',
    pickers: 'és ▾xhigh: a modell és az effort; megnyomva váltható',
    agents: 'az új subagentek ezt kapják; csak ebben a sessionben',
    workflow: 'egy workflow futása: alatta az agentjei; megnyomva mind látszik',
    commands: '/tree close bezárja a panelt; /tree újra megnyitja',
    keys: ['ctrl+x tab: a panel fókuszba kerül', '↑ ↓ mozgás · ↵ vagy kattintás: átirat', 'main sor: vissza a beszélgetéshez'],
  },
  glance: { running: n => `${n} fut`, waiting: n => `${n} vár`, done: n => `${n} kész`, failed: n => `${n} hibás` },
  log: {
    resumed: 'folytatva',
    started: 'elindult',
    spawned: model => `indult · ${model}`,
    found: model => `észlelve · ${model}`,
    calledBy: who => `hívta: ${who}`,
    context: p => `kontextus ${p}%`,
    compacted: 'kontextus tömörítve',
    waiting: 'vár',
    done: tools => `kész · ${tools} eszköz`,
    interrupted: 'megszakítva',
    refused: 'elutasította',
    error: 'hiba',
    stopped: 'leállítva',
    failed: 'sikertelen',
  },
  chooseLanguage: 'Válassz nyelvet',
  sessionModel: 'A session modellje',
  sessionEffort: 'A session effortja',
  savedAsDefault: 'az új sessionök alapja is lesz',
  defaultModel: 'Alapértelmezett',
  effortWord: 'effort',
  advisorTitle: 'Advisor',
  offLabel: 'Ki',
  auto: 'auto',
  agents: 'agentek',
  modelLabel: 'modell: ',
  effortLabel: 'effort: ',
  forced: '(env)',
  agentModelTitle: 'Új subagentek modellje',
  agentEffortTitle: 'Új subagentek effortja',
  agentModelNote: 'csak ebben a sessionben, Claude kérése helyett is',
  agentEffortNote: 'csak ebben a sessionben; a már dolgozók maradnak',
  runModelTitle: who => `${who} · modell`,
  runModelNote: 'következő kéréstől; kontextus új áron újraolvasva',
  messageTo: who => `Üzenet: ${who}`,
  messageHint: 'Írd be alább az üzenetet',
  messageLabel: 'üzenet',
  options: {
    title: 'Beállítások',
    note: 'A Claude Code beállításai közé kerül (/config), minden sessionre',
    language: 'Nyelv',
    labels: { openOnStart: 'Megnyitás induláskor', animate: 'Mozgás', columns: 'Szélesség', logRows: 'Naplósorok', limitWarnAt: 'Limit: sárga ettől', limitAlertAt: 'Limit: piros ettől', bandLine: 'Sor a prompt fölött', advisorSound: 'Advisor hang', autoUpdate: 'Automatikus frissítés' },
    about: { openOnStart: 'interaktív session indulásakor megnyílik a panel', animate: 'a pörgő jel, a sávok fénye, a fa fénye', columns: 'a dokkolt panel szélessége, a következő megnyitástól', logRows: '0 elrejti a naplót', limitWarnAt: 'ettől a résztől sárga a limit sávja', limitAlertAt: 'ettől pedig piros', bandLine: 'amíg a panel zárva van', advisorSound: 'macOS: csengő; Windows: két sípolás; Linux: semmi', autoUpdate: 'naponta, a GitHubról; csak telepített példányon' },
  },
  messageLog: 'üzenet elküldve',
  messageFailed: reason => `${NAME}: az üzenet nem érkezett meg: ${reason}`,
  messageLegend: 'üzenet egy agentnek; a befejezett újraindul',
  said: text => `${NAME}: ${text}`,
  switchFailed: (command, value) => `${NAME}: a /${command} ${value} nem futott le`,
  notApplied: (command, value) => `${NAME}: a /${command} ${value} nem lépett életbe`,
  updated: version => `${NAME}: frissítve erre: ${version}; a /reload-plugins vagy egy újraindítás tölti be`,
  updateFailed: (version, command) => `${NAME}: nem sikerült frissíteni erre: ${version}; kézzel: ${command}`,
  command: {
    description: `Az ${NAME} panel megnyitása; a "close" bezárja`,
    closed: `${NAME} bezárva.`,
    opened: `${NAME} megnyitva.`,
    waits: reason => `${NAME} vár: ${reason}`,
    none: `${NAME}: nem sikerült perjeles parancsot regisztrálni; a panel induláskor így is megnyílik.`,
    failed: `${NAME}: a parancs nem sikerült; lásd claude --debug.`,
    drawFailed: `${NAME} nem tudta kirajzolni ezt a képkockát.`,
  },
}

const WORDS: Readonly<Record<Lang, Words>> = {
  en: EN,
  hu: HU,
  ...europeanWords(NAME),
  ...nordicWords(NAME),
  ...southernWords(NAME),
  ...slavicWords(NAME),
  ...asianWords(NAME),
}

export function wordsFor(lang: Lang | undefined): Words {
  return WORDS[lang ?? 'en'] ?? EN
}

/**
 * How a free text names each language: its code (`de`, `de-DE`,
 * `de_DE.UTF-8`, the three-letter ones too), or its name in English or in
 * itself (`German`, `Deutsch`).
 */
const NAMED: ReadonlyArray<readonly [Lang, RegExp]> = [
  ['hu', /^(hu|hun)([-_.\s]|$)|^(hungarian|magyar)/],
  ['en', /^(en|eng)([-_.\s]|$)|^(english|angol)/],
  ['cs', /^(cs|cz|ces|cze)([-_.\s]|$)|^(czech|čeština|cestina)/],
  ['de', /^(de|deu|ger)([-_.\s]|$)|^(german|deutsch)/],
  ['es', /^(es|spa)([-_.\s]|$)|^(spanish|español|espanol)/],
  ['fr', /^(fr|fra|fre)([-_.\s]|$)|^(french|français|francais)/],
  ['nl', /^(nl|nld|dut)([-_.\s]|$)|^(dutch|nederlands)/],
  ['pl', /^(pl|pol)([-_.\s]|$)|^(polish|polski)/],
  ['tr', /^(tr|tur)([-_.\s]|$)|^(turkish|türkçe|turkce)/],
  ['da', /^(da|dan)([-_.\s]|$)|^(danish|dansk)/],
  ['it', /^(it|ita)([-_.\s]|$)|^(italian|italiano)/],
  ['no', /^(no|nb|nn|nor|nob|nno)([-_.\s]|$)|^(norwegian|norsk|bokmål|bokmal|nynorsk)/],
  ['pt', /^(pt|por)([-_.\s]|$)|^(portuguese|português|portugues)/],
  ['ro', /^(ro|ron|rum)([-_.\s]|$)|^(romanian|română|romana)/],
  ['sk', /^(sk|slk|slo)([-_.\s]|$)|^(slovak|slovenčina|slovencina)/],
  ['sl', /^(sl|slv)([-_.\s]|$)|^(slovenian|slovene|slovenščina|slovenscina)/],
  ['sr', /^(sr|srp)([-_.\s]|$)|^(serbian|srpski|српски)/],
  ['fi', /^(fi|fin)([-_.\s]|$)|^(finnish|suomi)/],
  ['sv', /^(sv|swe)([-_.\s]|$)|^(swedish|svenska)/],
  ['el', /^(el|ell|gre)([-_.\s]|$)|^(greek|ελληνικά)/],
  ['ja', /^(ja|jpn)([-_.\s]|$)|^(japanese|日本語)/],
  ['ko', /^(ko|kor)([-_.\s]|$)|^(korean|한국어)/],
  ['zh', /^(zh|zho|chi)([-_.\s]|$)|^(chinese|中文|简体中文)/],
]

/** A language a free text names: `hu`, `hu-HU`, `hu_HU.UTF-8`, `Hungarian`, `magyar`, `Deutsch`, `日本語`; else none. */
export function langOf(text: unknown): Lang | undefined {
  if (typeof text !== 'string') return undefined
  const t = text.trim().toLowerCase()
  return NAMED.find(([, pattern]) => pattern.test(t))?.[0]
}

/**
 * The pane's language: the person's own choice, else what can be read off
 * Claude Code's `language` setting, the runtime's locale (the system's display
 * language) or `LANG`, else English. Only a choice is ever saved.
 */
export function chooseLang(hints: { saved?: unknown; setting?: unknown; locale?: unknown; env?: unknown }): Lang {
  if (isLang(hints.saved)) return hints.saved
  return langOf(hints.setting) ?? langOf(hints.locale) ?? langOf(hints.env) ?? 'en'
}
