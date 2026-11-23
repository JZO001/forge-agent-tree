// The $.state contract of the forge-agent-tree mod: every value it keeps for a
// session, under the plugin's name. Bump an atom's shape tag in the code when
// the shape of its value changes, so a hot reload declines what older code
// stored instead of misreading it.

/** Where an agent stands, as the pane draws it. */
export type AgentState = 'starting' | 'running' | 'waiting' | 'idle' | 'done' | 'failed' | 'stopped'

/** Why an agent's run ended, as `turn.complete` reported it. */
export type EndReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type TreeAgent = {
  id: string
  parentId?: string
  /** The Agent tool's short description of the task. */
  description: string
  /** The agent type (`Explore`, `general-purpose`, a plugin's agent, `fork`). */
  type: string
  /** A teammate's or named agent's address. */
  name?: string
  model?: string
  effort?: string
  state: AgentState
  /** When `state` last changed. */
  since: number
  startedAt: number
  endedAt?: number
  endReason?: EndReason
  background?: boolean
  fork?: boolean
  teammate?: boolean
  /** Started by a workflow script's `agent()`. */
  workflow?: boolean
  /** The workflow run it belongs to (`runId`): it is drawn under that run's row. */
  run?: string
  /** Made up from an event of an agent no spawn has named yet (its `turn.start` comes first); a spawn fills it in. */
  bare?: true
  /** Tool calls seen for this agent. */
  tools: number
  /** The last tool call, short: `Grep src/auth/**`. */
  activity?: string
  /** The engine's progress summary of the agent. */
  label?: string
  tokens?: number
  window?: number
  samples?: number[]
  costUsd?: number
  /** Seen in `$.agent.list()` at least once. */
  listed?: boolean
  /** How many times this agent asked the advisor. */
  advisorCalls?: number
  /** The call (`tool_use_id`) put to the person, which the agent waits on (a permission dialog; plan 19 §7). */
  asking?: string
}

/** How a workflow run ended, as its notification says. */
export type RunEnd = 'completed' | 'failed' | 'killed'

/** The members' ends the tree no longer holds (it keeps at most 60 agents), so the run's counts stay whole. */
export type RunGone = { done: number; failed: number; stopped: number }

/** A workflow run: one row in the tree, its agents under it. */
export type TreeRun = {
  /** The run's id (`wf_…`), as `agent.spawn`'s `workflow.runId` and the Workflow tool's result give it. */
  id: string
  /** The script's `meta.name`. */
  name?: string
  /** The script's `meta.description` (the tool result's `summary`). */
  about?: string
  /** The background task's id: the end notification names it. */
  taskId?: string
  /** The Workflow tool call that started it. */
  toolUseId?: string
  /** The agent that called the Workflow tool; absent for the main conversation. */
  parentId?: string
  startedAt: number
  endedAt?: number
  /** How it ended, from its notification. */
  end?: RunEnd
  /** No notification came, and nothing of it worked for a while: taken as ended. */
  settled?: boolean
  gone?: RunGone
}

export type TreeLimit = {
  /** `five_hour` (the session's window), `seven_day` (the week's), or a gateway's own. */
  kind: string
  percent: number
  /** When the window resets, ISO 8601. */
  resetsAt?: string
}

export type TreeMain = {
  model?: string
  effort?: string
  /** First line of the prompt the current or last turn runs on. */
  prompt?: string
  activity?: string
  tools: number
  isBusy: boolean
  turnStartedAt?: number
  turnEndedAt?: number
  /**
   * Whether the person started the current or last main turn: their own prompt
   * (typed, from Remote Control, or -p's) woke it, or they typed into it while it
   * ran. False for one a background task's notification, a scheduled prompt or
   * another session woke (plan 19 §6); unknown where the mod did not see it start.
   */
  turnByPerson?: boolean
  /** The last main turn's end tells nothing (no sound, no notification): the person pressed Esc, or did not start it (plan 19 §5, §6). */
  turnQuiet?: boolean
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  /** The context's tokens when the last main turn ended. */
  lastTurnTokens?: number
  /** How the context grew (or shrank) over the last main turn, in tokens. */
  turnDelta?: number
  /** The context figures are a local estimate: no response has measured this window yet. */
  contextEstimated?: boolean
  costUsd?: number
  hasUnknownPrice?: boolean
  limits?: TreeLimit[]
  /** The limits are the last ones known from an earlier session, until a response here reports them. */
  limitsEstimated?: boolean
  /** The highest context threshold (75 or 90) already logged. */
  warnedAt?: number
}

export type AdvisorCall = {
  /** When the call started. */
  at: number
  /** When the pane learnt of it: its response brings it, seconds after it started. The HUD's flash runs from it. */
  seen?: number
  ms?: number
  /** The calling agent's id; absent when the main conversation called. */
  by?: string
}

export type TreeAdvisor = {
  model?: string
  /** Switched off: `/advisor off`, or CLAUDE_CODE_DISABLE_ADVISOR_TOOL. */
  off?: boolean
  total: number
  /** The latest calls, newest last. */
  calls: AdvisorCall[]
  /** Calls the main conversation made, and the agents. */
  fromMain?: number
  fromAgents?: number
  /** Calls whose length is known, their summed and longest length. */
  timed?: number
  totalMs?: number
  maxMs?: number
}

export type LogKind = 'spawn' | 'done' | 'failed' | 'stopped' | 'waiting' | 'advisor' | 'context' | 'compact' | 'model' | 'message' | 'run'

export type LogEntry = {
  /** When it happened: the log is in this order, newest first. */
  at: number
  /** When the pane learnt of it, where that came later (an advisor call, a run's end): the HUD types the row in from it. */
  seen?: number
  kind: LogKind
  /** The agent the entry is about; absent for the main session. */
  agentId?: string
  /** Who: an agent's description, `main` or `advisor`. */
  label: string
  text: string
  /** Right-aligned result: a duration, a count. */
  right?: string
  /** A context entry's share of the window, for its weather sign. */
  percent?: number
  /**
   * What `text` says, as a phrase and its value, so the pane writes it in its
   * own language; absent on an entry an older version wrote (`text` then).
   */
  say?: LogSay
  /** The length `right` gives, in milliseconds, written in the pane's language. */
  ms?: number
}

export type LogPhrase =
  | 'resumed'
  | 'spawned'
  | 'found'
  | 'calledBy'
  | 'context'
  | 'compacted'
  | 'waiting'
  | 'done'
  | 'interrupted'
  | 'refused'
  | 'error'
  | 'stopped'
  | 'failed'
  | 'messaged'
  | 'started'
  | 'runDone'

export type LogSay = { phrase: LogPhrase; value?: string | number }

export type TreeState = {
  startedAt: number
  /** The session the tree was built for; another one in place (a /resume, a /clear) starts its own. */
  sessionId?: string
  main: TreeMain
  agents: TreeAgent[]
  /** The workflow runs, oldest first. */
  runs?: TreeRun[]
  advisor: TreeAdvisor
  /** Newest first. */
  log: LogEntry[]
  /** What the choice panels offer and what they asked for; absent before the first reading. */
  choices?: TreeChoices
}

export type TreeChoices = {
  /** What `/model` offers: the `/config` model row's options, as aliases (`opus`, `sonnet[1m]`, `default`). */
  offer?: string[]
  /** The model row's value: the model in use, as an alias. */
  modelSetting?: string
  /** A trusted source (policy, managed settings) owns the model: the pane offers no choice. */
  modelLocked?: boolean
  /** A `/model` the pane ran that has not taken effect yet. */
  pendingModel?: string
  /** An `/effort` the pane ran that has not taken effect yet. */
  pendingEffort?: string
  /** An `/advisor` the pane ran that has not taken effect yet: a model alias or `off`. */
  pendingAdvisor?: string
  /** When the pending command was asked for. */
  pendingSince?: number
  /** CLAUDE_CODE_DISABLE_ADVISOR_TOOL turns the advisor off: the pane offers no choice. */
  advisorLocked?: boolean
  /** The model new subagents get, an alias (`haiku`); absent: as Claude or the agent's definition says. This session only. */
  agentModel?: string
  /** The effort new subagents' requests carry; absent: their own. This session only. */
  agentEffort?: string
  /** CLAUDE_CODE_SUBAGENT_MODEL forces every subagent's model, over the pane's choice too. */
  agentModelForced?: string
  /** The effort each subagent was given when it started, by agent id: it keeps it whatever is chosen later. */
  pins?: Record<string, string>
  /** Agents already at work when the effort was last chosen: they keep their own. */
  exempt?: string[]
  /** A running subagent switched to another model from the pane, by agent id: its requests from then on (an alias). */
  runModels?: Record<string, string>
}

/** What the pane shows: the tree, the help, the options page, or the sounds page (plan 09) or the notifications page (plan 12) under it. */
export type TreeView = 'tree' | 'help' | 'options' | 'sounds' | 'notices'

/** The languages the pane speaks: English, Hungarian and 21 more the user asked for. */
export type Lang =
  | 'en'
  | 'hu'
  | 'cs'
  | 'da'
  | 'de'
  | 'es'
  | 'fr'
  | 'it'
  | 'nl'
  | 'no'
  | 'pl'
  | 'pt'
  | 'ro'
  | 'sk'
  | 'sl'
  | 'sr'
  | 'hr'
  | 'fi'
  | 'sv'
  | 'tr'
  | 'el'
  | 'ja'
  | 'ko'
  | 'zh'

/** The choice panels under the header. */
export type PickerId = 'lang' | 'model' | 'effort' | 'advisor' | 'agentModel' | 'agentEffort' | 'runModel' | 'msgEffort'

export type TreeUi = {
  showFinished: boolean
  showLog: boolean
  view: TreeView
  /** The choice panel open under the header; none when absent. */
  picker?: PickerId
  /** The agent a `runModel` panel is for. */
  pickerFor?: string
  /** The agent the message panel at the pane's foot is open for. */
  compose?: string
  /** The effort chosen in the message panel, set on the agent when the message goes; `auto` gives it back its own. */
  composeEffort?: string
  /** The pane's language: the person's choice ($.store), else one read off the system; English when absent. */
  lang?: Lang
  /** The workflow runs pressed open, to show every agent, the finished ones too. */
  openRuns?: string[]
  /** The workflow runs pressed closed while `showFinished` would show them: a run row's press wins over `f`. */
  closedRuns?: string[]
  /**
   * The whole tree a page at a time (plan 13): the first of its rows shown,
   * set by pressing `+ n more` and by the paging row's `▲` and `▼`; none, the
   * rows that matter most. Not stored; a session swap starts without it.
   */
  treeAt?: number
}

/**
 * What the pane draws with, read off Claude Code's settings (its theme,
 * `prefersReducedMotion`), the options' locks and the mod's own manifest (its
 * version). Kept across a reload, so the first drawing after a change of
 * options is not in the defaults' colors.
 */
export type TreeLook = { theme: 'dark' | 'light' | 'ansi'; reduced: boolean; locked: string[]; /** The mod's own version, from its manifest: the help shows it. */ version?: string }

/**
 * What the pane did at this process's start, kept across a reload (a change of
 * options reloads the plugin and its start runs again): a reload neither
 * reopens a pane the person closed nor boots it and sounds its power-up again.
 */
export type TreeStart = { opened?: boolean; poweredUp?: boolean }

/**
 * What came of the mod's last notification (plan 14): sent through Claude
 * Code's channel (which), sent as a Windows notification where it has none,
 * or not shown (why). The notifications page shows it; empty before any.
 */
export type TreeNotice = { at?: number; kind?: 'sent' | 'windows' | 'not'; channel?: string; reason?: string }

declare module 'claude-code' {
  interface PluginState {
    'forge-agent-tree': {
      tree: Shaped<TreeState>
      ui: Shaped<TreeUi>
      frame: number
      /** Bumped whenever the pane opens or closes: the line above the prompt draws again. */
      pane: number
      look: Shaped<TreeLook>
      start: Shaped<TreeStart>
      notice: Shaped<TreeNotice>
    }
  }
}
