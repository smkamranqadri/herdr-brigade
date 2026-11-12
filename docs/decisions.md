# Decisions

## Toolchain (2026-11-08)

| Item | Version | Reason |
| --- | --- | --- |
| Node | 22.23.3, pinned in `mise.toml` and `engines`; `.npmrc` has `engine-strict` | It runs TypeScript directly (type stripping), so there is no build step. `scripts/check-node.ts` fails the gate on any other version. |
| npm | 10.9.9 (`packageManager`) | The npm that ships with the pinned Node. |

## Dev dependencies (2026-11-08)

There are no runtime dependencies. The MCP server is our own code (guide D1).

| Package | Version | Why | Alternatives |
| --- | --- | --- | --- |
| `typescript` | 6.0.3 | Strict type check | 7.0.2 is newer, but `typescript-eslint` 8.72 supports only `<6.1`. |
| `@types/node` | 22.20.5 | Types for Node 22 | — |
| `vitest`, `@vitest/coverage-v8` | 5.1.0 | Tests and the coverage floor (guide T9) | `node:test` has no coverage threshold. |
| `eslint`, `@eslint/js` | 10.14.0, 10.0.1 | Lint, complexity, file size (guide C3) | Biome has no max-lines rule. |
| `typescript-eslint` | 8.72.1 | Type-aware lint rules | — |
| `prettier` | 3.9.10 | Format | Biome |
| `dependency-cruiser` | 18.7.2 | Import rules between layers (guide A1) | `eslint-plugin-boundaries` |
| `knip` | 6.44.2 | Unused code and dependencies (guide C10) | — |
| `lefthook` | 2.2.2 | Pre-commit hook (guide S7) | `husky` |

All are a year or more old, with releases this year and a known team or company behind them (guide D2). `knip` and `lefthook` list one npm maintainer each; their projects have wider teams (webpro and Evil Martians).

## Accepted advisory: `minimatch` in the dev tools (2026-11-08)

`npm audit` reports 10 moderate findings, all from one advisory: `minimatch` from 7.0.0 up to 11.0.1 can be slowed down by a crafted glob pattern. eslint 10.14 and typescript-eslint 8.72 depend on `minimatch` 10.2.6.

- **Why we accept it:** these are dev tools. They only match glob patterns from our own config files, so no attacker controls the input.
- **Why no fix yet:** npm's suggested fix downgrades eslint. Forcing `minimatch` 11 with `overrides` would put a 12-day-old major version under eslint, which guide D2 advises against.
- **Check:** the gate runs `npm audit --omit=dev`, which covers the runtime profile (empty).
- **Revisit:** when eslint or typescript-eslint moves to `minimatch` 11, or by 2026-12-08, whichever comes first.

## Permissions per role (2026-11-08, owner's choice)

Each role's config takes `permissions`: `ask`, `auto` or `bypass`. Workers default to `auto`; the Coordinator and Captains default to `ask`. Coordinators and Captains also never get Bash, Edit or Write, whatever their level.

- **Why:** with `ask`, a Claude worker stopped at every `git commit` until the owner approved it in Herdr.
- **Risk accepted:** the owner's lore says not to pass `--permission-mode auto` to `herdr agent start` (the older TUI). With `hc` and Claude Code 2.1.319, auto mode started with no opt-in screen, and a worker committed with no prompt (`docs/e2e-runs.md`). Auto mode still refuses some actions on its own, such as production deploys, `ssh` and credential reads.
- Claude Code's mode for each level: workers `acceptEdits` / `auto` / `bypassPermissions`; Coordinators and Captains `manual` / `auto` / `bypassPermissions`. `manual` replaces `default`, which is no longer on Claude's documented list.

## Workers commit through brigade (2026-11-08, owner's choice)

Codex's `workspace-write` sandbox keeps git metadata read-only, even with `--add-dir`, so a Codex worker cannot run `git commit`. Workers now have a `commit` tool: brigade's MCP server, which runs outside the agent's sandbox, runs `git add -A` and `git commit` in that worker's own worktree. The worktree comes from the event log, never from the agent. Every harness uses the tool, so the rule is the same everywhere.

- **Alternatives rejected:** running Codex workers with no sandbox (as Box Yard does), or leaving their work uncommitted.
- **Note:** the repo's own git hooks run during that commit, outside the agent's sandbox, as they would for a person.

## Trust prompts are answered, and saved, by the harness (2026-11-08)

Claude Code and Codex ask once per folder whether to trust it. Brigade answers yes for the folders it starts agents in, one checked key at a time. Each harness then saves the folder as trusted in its own global file (`~/.claude.json`, `~/.codex/config.toml`). Each new worktree adds an entry. `-c projects."<folder>".trust_level` did not skip Codex's prompt.

## Git hooks: on for Claude and pi, off for sandboxed Codex workers (2026-11-09, owner's choice)

**The problem with Codex.** A Codex worker runs in Codex's `workspace-write` sandbox. That sandbox keeps `.git` read-only, so the worker can't commit, and brigade commits and pushes for it, outside the sandbox. git runs the repo's hooks during those calls. A hook manager such as lefthook reads its commands from files in the worktree (`lefthook.yml`, `package.json` scripts), and the worker can edit those. So a sandboxed worker could write any command into such a file, and brigade's commit would run it outside the sandbox. Seen in code review on 2026-11-09, and shown with a test hook; not seen from a real agent.

**The rule.** brigade's commit and push run the repo's hooks unless the worker is sandboxed (`sandboxed(spec)` in `src/domain/agent.ts`): a Codex worker on any level but `bypass`. Then git runs with `core.hooksPath=/dev/null`. Claude Code and pi workers have no sandbox here, so a hook gives them nothing they couldn't do already, and the owner's checks run on their commits.

**What it costs.** A sandboxed Codex worker's commits skip the repo's pre-commit checks. The worker prompt says to run the checks before committing. The owner's own commits and any CI still run them.

**Revisit when:**
- Claude Code's optional sandbox is turned on for brigade's agents. Then Claude workers are sandboxed too, and `sandboxed()` must say so.
- Codex gets a way to run hooks inside its sandbox, or brigade runs the hooks in a sandbox of its own.
- Note: Codex workers are still launched with `--add-dir <repo>/.git`, which has no effect (Codex keeps git metadata read-only). It is harmless and left as it is.

Rejected: hooks off for everyone (the owner's checks never run on brigade commits), and hooks on for everyone (a sandboxed Codex worker could escape through a hook).

## The Coordinator loads the owner's own MCP servers (2026-11-10, owner's choice)

The owner asked the Coordinator for their to-do list in Tartib, but a Claude agent started with `--strict-mcp-config` loads brigade's MCP server alone. A Claude Coordinator now starts without that flag, so it also loads the owner's own servers from their Claude config (Tartib, a browser, Pencil...). Calls to them still need the owner's approval at the `ask` level: only `mcp__brigade` is pre-allowed. Captains and workers keep brigade's server alone.

- **Rejected:** a per-role list of named servers (more precise, more config) and no change.
- **Known gap, Codex:** Codex reads the owner's `~/.codex/config.toml`, so a Codex agent in any role already loads the owner's MCP servers there. Codex plugins add more servers, such as computer use. Brigade adds its own server but does not turn those off. Not fixed yet.
- **Known gap, pi:** pi 1.5 has built-in MCP support and reads the owner's `~/.pi/agent/mcp.json`, so a pi agent in any role loads the owner's MCP servers too, with no approval prompt. `--no-mcp` is not a fix: it would also turn off brigade's own server, which `pi-extension/brigade.ts` registers through the same support. Not fixed yet.
- **Not fixed, on purpose (2026-11-11):** the owner runs every role on Claude Code, so neither gap reaches them. `kis/intent/backlog.md` holds the fix for when a role moves to Codex or pi.

## The Coordinator and Captains resume by folder, not by session id (2026-11-11, owner's choice)

Each start of the Coordinator or a Captain continues the newest session in its own folder: `claude --continue`, `pi --continue` or `codex resume --last`. Workers start new, since a worker's conversation ends with its task.

- **Why folders.** Codex can't take a session id at start. It writes its session file only after the first message, and its MCP servers see no session id variable (probed 2026-11-11). Claude and pi could take ids, but one way for all three keeps the harnesses alike.
- **What it needs.** The newest session in a folder must be the agent's own. The Coordinator's folder already was. A Captain ran in the repo, beside the owner's own sessions, so it now runs in `<state>/captains/<project>` and reads the repo through `--add-dir` (Claude). Codex's read-only sandbox and pi already read any folder. The Captain prompt tells it to read the repo's `AGENTS.md` or `CLAUDE.md`, which no longer load by themselves.
- **No session.** `claude --continue` prints "No conversation found to continue" and ends; brigade removes that terminal and starts once more with a new session. pi and Codex start new by themselves.
- **Rejected:** session ids stored by brigade (no way to get Codex's), and reading Codex's private session files.

## The Brigade space: tabs, Captains end with the Coordinator, core keep off (2026-11-11, owner's choice)

`brigade start` opens a herdr-app space named Brigade, in the Coordinator's folder, with the Coordinator in tab 1. A Captain gets a tab on `brigade start` or when the owner clicks it; it starts in the background. (Changed on 2026-11-12: see "Project spaces and worker resume".) Facts from the probe are in `docs/herdr-app.md`.

- **Tabs through `terminal.keep`.** Brigade starts every agent through hc, with its name, labels, parent and tool limits. herdr-app's `space.new`, `tab.new` and `terminal.open` start a program of their own, so only `terminal.keep` can give brigade's terminal a tab.
- **Captains end with the Coordinator.** They start without hc's `--outlive-parent`, so closing the space or the Coordinator's tab stops them too, and they resume next time. Workers keep the flag, so `hc kill` on a Captain leaves them running.
- **Closing the space ends the workers too.** herdr-app ends a terminal's sub-agents with it, even those with `--outlive-parent` (live check 6, 2026-11-11). Workers could survive only with no hc parent; the owner chose to accept the stop instead. A worker's worktree, commits and file edits stay on disk, and no worker is left reporting to a Captain that is gone.
- **Core keep off.** `terminal.keep` turns hc's core keep on. With it on, a reboot leaves a shell in place of the agent, and a tool such as the owner's revive mod can resume the agent there without brigade's tool limits or MCP server. So brigade runs `hc keep <t> --off` after each tab it opens, also when opening fails, and on every brigade terminal at the end of `brigade start`.
- **Not known:** what herdr-app does with kept terminals after a window restart or a reboot. The owner's window must not restart for a probe.
- **Rejected:** keeping the peek (Esc in a peek interrupts the agent), and marking brigade terminals for the revive mod to skip (it would tie brigade to one owner's mod).

## Project spaces and worker resume (2026-11-12, owner's choice)

The Brigade space holds only the Coordinator, so the owner finds it at once; 3c adds the TUI pane there. Facts from the probe are in `docs/herdr-app.md`.

Changed later on 2026-11-12, the owner's choice: Captain tabs go back to the Brigade space, after the Coordinator. A Captain runs in a folder of its own, not in the repo, and herdr-app already nests it under the Coordinator as its sub-agent. Only workers get tabs in project spaces.

- **Project spaces.** A worker's tab goes in the first space, in herdr-app's order, whose folder is exactly the project's repo. A subfolder does not count. With no match, brigade makes a space named after the project. Spaces are found by folder only, because the owner's space names differ from repo names and several spaces can share a folder.
- **A Captain's tab at start, with the view back.** herdr-app makes a tab only in the shown space, so the view jumps to the Brigade space. Brigade then shows the owner's earlier tab again (best effort: a closed tab or space is skipped). If the tab fails, the Captain still runs, and the Coordinator's reply says so.
- **Worker tabs on a click.** A task click opens the worker and stays there: the owner asked to see it.
- **Worker resume by folder.** A worker runs only in its task's worktree, so, as for Captains, brigade continues the newest session there and stores no session ids. A resumed worker gets the task's own model, limits and pinned repo, and the running Captain as its parent. It gets no first message: its brief is in its old conversation. When Claude finds no session, or the worker never becomes ready, brigade removes the terminal and refuses: a new conversation would have no brief. One resume per task runs at a time, under a file lock.
- **A Captain must run.** A worker reports to its Captain, so a resume without one refuses: "Start the <project> Captain first."
- **Known risk, Codex and pi:** they start a new conversation when they find no session, and they don't say so. A resumed Codex or pi worker whose session was deleted would run without its brief. Brigade does not read their private session files to check. The owner accepted this risk.

## Gaps against the guide, on purpose (guide P8)

- **CI (S7, Q3):** none yet; there is no remote. Add it when the repo gets one.
- **Secret scan in pre-commit (part 7, tier 1):** `gitleaks` is not installed. Adding it needs the owner's OK (a new tool).
