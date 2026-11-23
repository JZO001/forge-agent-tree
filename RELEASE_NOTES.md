# Release notes

## 0.1.1 (2026-11-23)

Fixes from a live test of the first release, plus a new language.

- **Theme changes reach the HUD at once.** The look (theme, reduced motion) is read every second, so `/theme` recolors the Forge HUD within a second instead of up to 10.
- **The line above the prompt** (with the pane closed) is rewritten after token-weather's line: the weather word, the context share, the sparkline and the last turn's change, with the context bar in place of token-weather's stripes. When token-weather's own line is on screen, ours steps aside; the agents' part shows only while something works or waits.
- **Paging with the keyboard keeps the focus ring on the paging buttons.** Pressing `▼` repeatedly pages on, `+ n more` lands on `▼`, and the ring no longer jumps to a row's `✎` or the keys row.
- **A new option, Notification gap** (notifications page and `/config`): the time between two notifications of one kind, `0`, `5`, `10` (default), `20`, `30` or `60` s. It was a fixed 30 s, which held a second "Turn complete" back too long. The host's hold follows the gap.
- **The end of the main turn notifies and sounds only for a turn you started.** Pressing Esc, or a background task's or a scheduled prompt's wake-up, ends a turn quietly.
- **Work that runs across `/clear` or `/resume` is no longer lost.** Running workflow runs (whole, with their finished agents) and running agents move to the new tree.
- **An agent waiting for your permission now shows as waiting.** The engine's list reports such an agent as running through the whole dialog, so the row kept the spinner. Now the row shows the yellow, blinking `‖` about a second after the dialog opens, with the log entry, the sonar and the "Agent waiting" notification, and goes back to work when you answer. In auto mode the classifier's decisions show no wait.
- **Croatian** (`hr`) joins the languages: 24 in all.
- Release notes (this file) and the help's version line.

## 0.1.0 (2026-11-20)

First release.

- The **Agent Tree // Forge** side pane: the session's agents as a live tree, with the header (model, effort, context, limits, advisor, team), the log and the keys row.
- Choice panels for the main model, effort and advisor, for new subagents, and for a running subagent; messages to a subagent.
- Workflow runs as one row each, folded or opened; the whole tree a page at a time.
- The Forge HUD look with its motion, and sci-fi sounds.
- Notifications (the person's own channel, a Windows notification where Claude Code has none), each event with its own switch.
- 23 languages, light and dark themes, a reduced-motion switch.
- An optional daily check for a newer version, off with the Auto-update option.
