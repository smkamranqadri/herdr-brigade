# End-to-end runs

Each run uses real agents in real `hc` terminals, with a scratch config, state folder, repo and worktrees (`BRIGADE_CONFIG`, `BRIGADE_STATE`, `BRIGADE_WORKTREES`).

## 2026-11-08: phase 1 step 3, all roles on Claude Code

Versions: hc 0.1.18, Claude Code 2.1.319, `claude-sonnet-5-5` at low effort for the Coordinator, the Captain and the worker.

Request typed into the Coordinator, in a dictated style: "ok so in the demo project can you add a hello file, hello.txt, with just the line hello from brigade, and commit it on the task branch, thats it".

| Step | Result |
| --- | --- |
| `brigade start` twice | The first started the Coordinator (`t9q`). The second said "Already running" (after the fix below). |
| Coordinator → `send_to_captain` | It rewrote the request as a full brief (goal, exact content, no push, what done means) and started the demo Captain (`t9r`). |
| Captain → `create_task` | It made branch `brigade/add-hello-txt-86b5d9` in its own worktree and started the worker (`t9s`). |
| Worker | It stopped on Claude's permission prompt for `git add` and `git commit` (see below). After one approval it committed and called `finish`. |
| Relay | Captain → `report` → Coordinator → owner, with "This is the worker's report; I did not check the commit myself." |
| Git, checked by hand | `a4b772e Add hello.txt` holds only `hello.txt`; `od -c` shows `hello from brigade\n`; the source repo's `main` was unchanged. |

### What the run found

- **Bug, fixed:** `hc ls --json` does not include labels, so brigade could not find a running Coordinator and tried to start a second one (`name_taken`). The `Terminals` port now asks `hc ls --label k=v` to do the matching.
- **The worker needs shell approval.** In `acceptEdits` mode, Claude asks before running shell commands such as `git commit`. The worker was blocked until the owner approved. `hc` then told the Captain the worker was blocked, and the Captain told the Coordinator. That relay worked well, but routine work needs a decision on the worker's permission mode.
- **A stale status can end a wait early.** `hc wait` returned at once with the old `blocked` status after the approval. Brigade itself never waits on status; it reacts to `finish` and `ask_user` events.

Not checked in this run: Codex or pi in any role (step 4), several workers at once (step 5), and `send_to_task` follow-ups with real agents.

## 2026-11-08: workers on `auto` permissions

The owner chose a per-role `permissions` setting (`ask`, `auto` or `bypass`), with workers on `auto` by default. Same setup as above, request "in demo, add bye.txt with the single line bye from brigade and commit it on the task branch, nothing else".

| Check | Result |
| --- | --- |
| Claude in auto mode shows no opt-in screen at start | Pass: started with no prompt, footer "auto mode on" |
| The worker commits with no approval prompt | Pass: created 11:01:01, `finish` 11:01:11; 0 approval prompts in its history |
| Git, checked by hand | `2f118b6 Add bye.txt` holds only `bye.txt`; `od -c` shows `bye from brigade\n`; worktree clean; `main` unchanged |

Found: the Captain first called a bare `create_task` ("No such tool available") and then the real `mcp__brigade__create_task`. The prompts now say the tools are on the `brigade` MCP server.

## 2026-11-08: phase 1 step 4, all roles on Codex

Versions: Codex CLI 0.167.0, `gpt-6.1-terra` at low effort for the Coordinator, the Captain and the worker. Request: "in demo add codex.txt with the single line hello from codex, commit it on the task branch, nothing else".

The first two attempts got stuck. Each fix below came from those attempts:

- **Codex shows its ready footer for about a second before its trust prompt.** Brigade read "? for shortcuts" as ready and stopped. Ready now has to hold for 3 seconds with no prompt.
- **Codex can draw the trust prompt before it reads keys.** A press it drops is now repeated. Brigade reads the cursor and presses Down or Enter one key at a time, and counts the prompt answered only once it is gone.
- **Codex 0.167 drops a first message given on its command line once its trust prompt shows.** Three probes showed this, with and without `--`, and after waiting 20 seconds. Brigade now types Codex's first message in after start.
- **`hc send` refuses while a new agent's output settles** ("still starting"). `send` now retries for up to 30 seconds on that error only.
- **`-c projects."<folder>".trust_level="trusted"` does not skip the trust prompt.** Answering the prompt saves the folder as trusted in `~/.codex/config.toml`, as Claude saves it in `~/.claude.json`.

Third attempt, after the fixes:

| Step | Result |
| --- | --- |
| Coordinator → Captain → worker, all on Codex | Pass. The Captain's brief was typed in once it was ready. The worker's trust prompt was answered and its brief typed in. |
| Worker commits | **Fail.** Codex's `workspace-write` sandbox keeps git metadata read-only, even with `--add-dir <repo>/.git`: `index.lock: Read-only file system`. The worker called `ask_user`, and the Captain reported the problem to the Coordinator correctly. |

The owner chose a brigade `commit` tool for workers (`docs/decisions.md`).

## 2026-11-09: phase 1 step 4, each harness in all three roles

Run with `scripts/e2e.sh <harness> "<request>"`. Each run has its own repo, config and state folder under `~/.local/state/herdr-brigade-e2e`. Request: "in demo add <harness>.txt with the single line hello from <harness>, commit it on the task branch, nothing else". Every check below was made by hand after the run, not taken from the agents' reports.

| Harness (model, effort) | Time | Commit (via the `commit` tool) | Checked by hand |
| --- | --- | --- | --- |
| Codex (`gpt-6.1-terra`, low) | 55 s | `ef76a93` | Only `codex.txt`, exact bytes (`od -c`), clean worktree, `main` unchanged, result relayed to the owner |
| pi (`openai/gpt-6.1-sol`, low) | 49 s | `6f36e5d` | Same checks; no agent loaded another project's `AGENTS.md` |
| Claude Code (`claude-sonnet-5-5`, low) | 36 s | `b972d89` | Same checks; no approval prompt in the worker's history |

Found on the way:

- **Runs inside a repo pick up its rules.** The first pi run sat under brigade's own folder: its agents loaded brigade's `AGENTS.md`, and the worker ran brigade's `npm run gate`. Runs now live outside any repo.
- **pi can drop the Enter of a message sent right after it starts.** The pasted request stayed in pi's input box until Enter was pressed again. `scripts/e2e.sh` now presses Enter again when no turn starts. Brigade itself gives pi its first message on the command line; a follow-up sent in pi's first seconds could still hit this (not seen yet).
- **Two machine restarts** (2026-11-08 23:08 and 2026-11-09 01:32) cleared `/tmp` and cut off two runs. That is another reason the runs no longer live in `/tmp`.

## 2026-11-09: phase 1 step 5, two workers at once

Load tests first, on real git and files:

- 8 `git worktree add` runs and then 8 commits, all in parallel in one repo, 5 times over: 0 errors in 80 operations. A 4-way version is now a regression test.
- 8 processes appending 300 events each to one event log at once: all 2,400 read back, none damaged. The fragment check added 55 blank lines, which reads skip.

Then `EXPECT_TASKS=2 scripts/e2e.sh <harness> "in demo do two separate tasks in parallel: one adds alpha.txt with the single line alpha, the other adds beta.txt with the single line beta. Each commits on its own task branch, nothing else"`:

| Harness | Time | Commits | Checked by hand |
| --- | --- | --- | --- |
| Claude Code (`claude-sonnet-5-5`, low) | 51 s | `522ff99` alpha, `29e2382` beta | Two branches, one file each, exact bytes, clean worktrees, `main` unchanged. The Captain received both reports and sent one combined report. |
| Codex (`gpt-6.1-terra`, low) | 75 s | `d29fa6a` alpha, `c6584ec` beta | Same checks. The beta report reached the Captain while it was still sending the alpha one; it reported each, and the Coordinator received both. |
