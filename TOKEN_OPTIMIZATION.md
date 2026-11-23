# Token optimization

We are working on ways to spend fewer tokens in Claude Code without getting worse answers. This page records each technique openly: what we did, what we measured, what it cost and what went wrong, so that anyone can check our claims.

| Technique | Status |
|---|---|
| [Knowledge base optimization](#knowledge-base-optimization) | **Experiment.** Tried by hand on this repository in November 2026, and not in the mod yet. When it ships, it will run only when you ask for it, never on its own. |
| [Delegation hints: model and effort for subtasks](#delegation-hints-model-and-effort-for-subtasks) | **Research.** A measurement plan exists; nothing is built or measured yet. |

## Knowledge base optimization

### The problem

Claude Code loads a project's instruction file (`CLAUDE.md`, and `AGENTS.md` through it) into **every** session. Every general-purpose subagent and workflow agent loads it again. Over time such a file grows: ours had reached 91 KB, about 30,000 tokens, and most of it was relevant only to a few tasks.

The idea: keep a small **core** that every task needs, move the rest into **topic files** (`AI/*.md`), and give the core a **map** that states, for every topic file, the tasks before which reading it is mandatory.

> In this repository the instruction files, the topic files and the optimization's working folder are kept local (git-ignored). The files named on this page are therefore not on GitHub; this page describes them.

### The method

1. **Backup.** Every run first copies the files it will touch. The instruction files are often git-ignored, as they are here, so git cannot be relied on to restore them.
2. **Inventory before.** The knowledge base is broken into atomic items, each one a rule, decision, fact, lesson, procedure or reference. Every item has:
   - a one-sentence statement;
   - a strength: must, should or info;
   - an exact quote from the source, with its line;
   - a date, who decided it, and the reason, when the text gives them.

   A script checks that every quote exists verbatim in the source and that every heading and paragraph is covered.
3. **Phase 1: a verbatim move.** The sections move to topic files unchanged. Only the core's map, its one-line summaries ("Always") and its working rules are new text. A script then checks that every non-empty line of the old file still exists, unchanged, in the new files.
4. **Comparison after.** Because the move is verbatim, every item's quoted line can be found mechanically, and its load condition comes from the map:
   - **kept in the core:** always loaded;
   - **demoted:** loaded only on its trigger;
   - **unreachable:** no trigger leads to it;
   - **lost.**
5. **Phase 2: condensing.** This phase removes duplicates and outdated parts. Every deliberate removal goes into a change log with its reason. *Not run yet.*
6. **Knowledge exam.** The same questions go to the old and the new knowledge base, to see whether the model still finds and applies the rules (details below).

#### The knowledge exam

- **Questions from the old inventory:** 60 questions, 8 on the core and 4 for each topic file.
  - **44 scenario questions:** a realistic small task whose right answer depends on a rule, without naming it (for example, "you add `started 3m ago` to an agent row: what color do `3m` and `ago` take?").
  - **16 recall questions.**
  - Each question has an answer key and a "wrong if" condition.
- **Two sandboxes.** Both are local clones of the repository with no remote. One holds the old instruction file, the other the new core and topic files.
- **Fresh headless sessions.** Every question runs in a new `claude -p` session in each sandbox, twice:
  - only the Read, Grep and Glob tools are available;
  - no MCP servers, and no saved session.

  The session's log shows which topic files the model read.
- **Blind grading.** A separate session in a neutral folder grades the four answers to each question against the key. It sees them under shuffled labels and never learns which knowledge base wrote which.
- **Regression:** the old knowledge base scores at least half a point better on average, counting pass as 1, partial as 0.5 and fail as 0.

### What we measured

All figures come from one repository, Claude Opus 5.5 at the user's settings, and API prices. On a subscription, the same work is counted against the usage limits instead.

| | Before | After |
|---|---|---|
| Instruction file always loaded | 91,340 bytes | 12,740 bytes (core) and 13 topic files of 3–11 KB |
| Prompt tokens of a minimal headless run | 71,962 | 42,031 (**29,931 fewer per load**) |
| Exam score, after the fixes below | 0.96 | **1.00** |
| Exam cost per question (mean) | $0.214 | **$0.12** (44% less), with 5.5 turns instead of 3.1 |

- **The prompt-token figure is a gross ceiling.** It comes from one run on each side. The net saving per load is about 29,900 tokens minus what the task reads from the topic files.
- **Claude Code writes its prompt cache with the one-hour lifetime.** On Opus 5.5 that costs $8 per million tokens, twice the input price. The cost of a run matched this to the cent. A cold start therefore costs about $0.24 less with the smaller core.
- **The model read the topic file a question belonged to in 74–76% of runs.** Where it did not, it mostly still answered correctly from the core or the code.
- **The exam's 60 questions are short question-and-answer tasks.** A long working session may show a different ratio.

#### What it cost to find out

- **The inventory:** six parallel agents, about 796,000 tokens in total, more than our earlier estimate for a whole run.
- **Re-rating the strength in one pass:** about 164,000 tokens.
- **Writing the exam:** about 203,000 tokens.
- **The two measuring runs:** $0.62.
- **The exam:** about $45, counting the runs, the grading, a smoke test, and a faulty rerun attempt we discarded.

**The one-time cost of the inventory and the exam is real.** Whether the optimization pays for itself has to be measured on real work, not assumed.

### Estimating the saving

The saving can be estimated before the split, from the project's own history, without a model call. Claude Code keeps a local transcript of every session (`~/.claude/projects/<project>/`). Each model request in it records its tokens:
- written to the prompt cache;
- read from it;
- uncached input;
- output.

The estimate replays that past work as if the smaller core had been in place.

- **The difference per load (Δ):** how many fewer tokens the always-loaded part carries. File sizes give a free estimate; two short headless runs, one per layout, measure it.
- **Which requests carry the instruction file:**
  - the main session, general-purpose subagents and workflow agents load it;
  - built-in search agents (such as Explore and Plan) and guide agents do not.
- **Written or read:**
  - On a cold start, the file is written to the cache. That covers a new session or agent, the first request after a compaction, and an expired cache. With the one-hour lifetime, a write costs twice the input price.
  - On every other request it is read, at a small fraction of the input price.
  - Each request's usage shows which.
- **The advisor** reads the forwarded transcript uncached, so every consultation pays for the file at the advisor model's input price.
- **What comes back:**
  - The topic files a task reads stay in the rest of that context.
  - Reading them can take extra turns, and each extra turn re-reads the whole context.

**Without history** (a new project, or an instruction file copied from another project), there is nothing to replay. The tool then shows:
- the gain per event: a cached request, a cold start, a new agent, an advisor consultation;
- generic example sessions, labeled as examples.

It also says that no project data exists yet, and that a real estimate is worth running after a few days of work.

#### Example: this repository

This is a projection, not a measurement. It takes two days of plugin development before the experiment ($497 at API prices) and recomputes them with today's file sizes.

| Topic files read per context | Net saving | Stays positive while the reads add fewer than |
|---|---|---|
| none (the upper bound) | 6.0% | 12.8% more turns |
| 2 | 5.0% | 10.7% more turns |
| 4 | 4.0% | 8.6% more turns |
| all 13 | −0.2% | never: it loses even without extra turns |

- **The upper bound in tokens:**
  - 18% fewer written to the cache;
  - 6.5% fewer read from it;
  - 6.8% less uncached advisor input.
- **Long main sessions gain little.** Their context runs to hundreds of thousands of tokens, so 30,000 fewer is a small share, and cache reads are cheap.
- **Cold starts gain the most:** new agents, headless runs, an expired cache. In the exam's short headless runs, the new layout cost 44% less per question.
- **Reading every topic file loses.** The split pays only when the triggers are precise.
- **The net depends on two things not yet measured on real work:** how many topic files a context reads, and how many turns that adds.
  - A later measurement on real sessions with the new layout replaces these assumptions.
  - The tool runs it only when you ask.

### What we learned (and what the tool must do)

1. **Move verbatim first, condense later.** A verbatim move can be proven lossless by a script: 502 of 502 lines here. Rewording cannot be proven that way, so it comes second, after the user approves the first phase, with a change log.
2. **Always back up.** Here the instruction files were git-ignored, so git would not have restored them.
3. **Give the inventory's raters one rubric.**
   - Six raters working on slices labelled "must" between 12% and 85% of similar descriptive text, so the counts could not be compared.
   - Re-rating everything in one pass, with one rubric and shared examples, fixed it: 703 must, 4 should, 254 info.
4. **"0 unreachable" proved nothing.** The map and the files came from the same list, so every file was reachable by construction. Only behaviour tests show whether a trigger fires for a real task.
5. **Check the summary lines.** The core's one-line summaries are new text. Two of our first seven were inaccurate against the source:
   - model names and signs are not translated;
   - three weather signs are the known exception to the one-cell rule.
6. **Name a trigger by topic, not only by files.**
   - The exam found two triggers that named files but not the topic. A question about logging notifications never opened the notifications file, so the model did not know a rule that forbids exactly that hook.
   - Widening both triggers fixed it.
   - For a cross-cutting rule that is costly to break, a one-line "Always" summary in the core worked even where the topic file was not opened.
7. **A single score can hide a knowledge gap.**
   - On one question, both versions failed the strict key. But the old one quoted the forbidding rule and flagged the conflict, while the new one did not know the rule at all.
   - Grade two things separately: does the answer **know** the rule, and does it **comply**.
   - When the task conflicts with a rule, flagging the conflict and asking counts as correct.
8. **The exam also finds drift between the knowledge base and the code.**
   - The new version opened the layout test and reported what it really does: it tests 7 widths. The instruction file said "every width from 36 to 120", and the old version repeated that.
   - It looked like a regression. It was a wrong rule, and we corrected the text.
   - A tool must report such cases as their own category: knowledge base and code disagree.
9. **Grading is noisy.** The same answer was graded "pass" once and "partial" once, depending on the answers graded beside it. Repeat every question, at least twice per version, and count a regression only when it is consistent.
10. **The runner must respect the budget exactly.**
    - Our first rerun counted earlier runs' cost twice and stopped after one run. We fixed it.
    - Running all first trials before any second trial means a budget stop still leaves every question answered once in both versions.
11. **Experiment in a sandbox.** We used local clones without a remote, no MCP servers, and read-only tools, so no test session could push, post or write anywhere.
12. **Subagents cannot stand in for fresh sessions.**
    - A subagent works in the parent's folder, gets the instructions the way the parent does, and inherits its framing.
    - Only a separate headless session shows how a new session behaves with a given knowledge base, and only that reports its exact tokens and cost.
13. **Be honest about the saving.**
    - In the main conversation the instruction file is read from the cache, which costs a fraction of a cent per request, so the saving there is small.
    - It is larger where many agents start or the cache goes cold, and every session gains context room.
    - We do not promise a quality gain.
    - On a subscription we cannot say how much more slowly the limits are used.

### Limits of this experiment

- One repository, one model, and question-and-answer tasks rather than real working sessions.
- Phase 2 (condensing) has not been tested.
- The saving estimate is a projection of past work, not a measurement of work done with the new layout.
- The grader is itself a model.

**Next:**
- real working sessions with the new layout;
- the same procedure on a second, larger project;
- behaviour tests on real coding tasks.

### Where the data goes

Everything runs on your machine, through your own Claude Code. The model calls are the ones Claude Code makes for you; the mod sends nothing anywhere else. The saving estimate only reads Claude Code's local transcripts of the project, and makes no model call. The backups, inventories, reports, estimates and exam results stay in the project (`AI/.kb/`). Nothing is committed or pushed by the procedure.

## Delegation hints: model and effort for subtasks

> **Research.** This section describes a plan. Nothing is built, and nothing below has been measured yet beyond the logs.

### The idea

When a request can be split, the model could hand parts of it to subagents, and give each part a model and an effort level that fit it. A search through files or a database does not need the most capable model at its highest effort.

The hint would reach the model in one of three ways (see below):
- with the request, as a short note the mod adds;
- in the project's instructions;
- or the mod applies it itself, by the kind of agent.

This is the lean opposite of an "everything in parallel" mode:
- it applies only when splitting makes sense;
- it uses few agents;
- each agent gets the cheapest setting that still does its part well.

### Where the money goes

The figures come from this repository's local Claude Code logs, at API prices, before any change:
- **About 80% of the cost was the main conversation,** and about 20% the subagents.
- **More than half of all cost was re-reading the context from the prompt cache.** Writing to the cache was about a quarter. All output, thinking included, was about a fifth.
- **The subagents' thinking was about 4% of the cost.**
- **The model never chose a model or an effort for a subagent on its own.** Every subagent inherited the main model and the session's effort.

What this means for the possible gains:
- **Lowering the subagents' effort has a small ceiling on its own.** It has a larger one only if it also cuts turns and reading, and we do not know that yet.
- **A cheaper model for search and research subagents has a larger ceiling.** A small model's tokens cost a fraction of a large one's.
- **Delegation that keeps the main context small aims at the largest block,** but it is a hypothesis, not a finding. Delegating also costs something: every subagent starts cold, with the system prompt and the project instructions.

### Three ways to carry the hint

1. **A line in the project's instruction file.**
   - Claude Code's tool instructions let the model set a subagent's effort only when the user, the project instructions or a skill ask for it, so this is an accepted source.
   - Other tools that read `AGENTS.md` see it too.
2. **A short note the mod attaches to a prompt a person typed.** It is never attached to the engine's own messages, and it stays in the conversation, so its own cost is measured too.
3. **Routing by the mod itself, by agent type, with no prompt:** for example, search agents on a smaller model. It does not depend on the model's judgment.

A workflow is started only when the user asks for one in their own words. A hint can at most make the model offer one.

### What we will measure

**Hypotheses:**
- Search tasks on a smaller model or at a lower effort are answered as correctly, at a much lower total cost.
- The three carriers differ in how often the model sets a model or an effort where it should, and leaves them where it should not.
- With the hint, the model delegates split-friendly tasks and not the others, without raising the total cost.
- Delegation makes the main context grow more slowly.
- Quality does not drop.

**Steps:**
1. **A carrier test:** does the model set a model or an effort, with each carrier? This step needs no grading.
   - It also compares a hint on every prompt with a hint once a session.
   - It checks whether a permission given in advance in the pane is enough to start a workflow.
2. **The effect of compaction:** does the model still follow a hint after the conversation is compacted? If not, the mod could repeat the hint after a compaction.
3. **A model and effort ladder:**
   - several models and effort levels against a baseline on search tasks;
   - the main conversation's effort on simple tasks.
4. **An A/B test on realistic tasks:** split-friendly and not, with and without the hint.
5. **Real work** with the option on.

**Rules for every step:**
- The total cost per task counts (turns and reading included), not thinking tokens alone.
- Correctness is graded blind, and every case runs twice.
- Each step has a stop rule, and its budget is approved before it runs.
- The tests run in a sandbox copy with no remote and no MCP servers.

Nothing ships unless the measurements show a gain without a loss of quality. If it ships, it is an option, off by default. A per-model cost view is not part of it.
