# Privacy

Agent Tree // Forge runs inside Claude Code on your machine. It reads what Claude Code tells it about your session, such as agents, models, context use, limits and cost, to draw its pane. It sends none of that anywhere.

## What leaves your machine

The mod sends nothing except its update check. The check is on by default and you can switch it off.

**The update check** runs at most once a day, when an interactive session starts:

1. **On your machine:** `claude plugin list --json`, to read the installed version and where it came from. Nothing leaves your machine for this. On Windows, where Claude Code was installed with npm (`claude.cmd`), the mod runs it through `cmd.exe /d /c`, and the update command below the same way. If the copy was not installed from a marketplace (for example, one run with `--plugin-dir`), the check stops here.
2. **One request,** only for a copy installed from a marketplace: a plain GET of `https://raw.githubusercontent.com/JZO001/forge-agent-tree/main/.claude-plugin/plugin.json`.
   - **Sent:** no cookies, no identifiers, nothing about you, your session or your code.
   - **Read:** only the `version` field.
   - **What GitHub sees:** what it sees for any download, such as your IP address and the time.
3. **The update,** only when that version is higher: `claude plugin update forge-agent-tree@<marketplace>`. This is Claude Code's own command; it fetches the repository from `github.com`, as the install did.

**Switch it off** in either of these ways:
- the **Auto-update** option on the pane's options page (`o`), or in `/config`;
- any of these environment variables, set to anything other than empty, `0` or `false`: `DO_NOT_TRACK`, `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.

## What stays on your machine

**In the mod's own store** (under `~/.claude/plugins/`):
- the pane's language;
- whether finished agents and the log show;
- the subagent choices of each session, deleted after 30 days;
- the last known plan limits;
- when the last update check ran, and a version that failed to install.

**In Claude Code's settings:**
- the options, kept as `/config` keeps them;
- a model, effort or advisor you pick in the pane: the pane runs `/model`, `/effort` or `/advisor` for you, and Claude Code saves the choice as those commands do.

**Elsewhere:** nothing. The mod writes no other files and makes no model calls. Its only other local processes play its sounds: in an interactive session with the Sound option on (on by default; switch it off on the options page), and when you press ► on the sounds page to hear one: PowerShell on Windows, `paplay` or `aplay` on Linux. They play the plugin's own sound files and send nothing anywhere.
