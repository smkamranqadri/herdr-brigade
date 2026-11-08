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

## 2026-11-09: phase 1 step 6, the Brigade panel

A real two-task Claude run (red.txt and blue.txt, 52 s, both committed), then the panel opened from the new Brigade button and checked in a screenshot:

- It showed the Coordinator, the demo project's Captain, both tasks as finished with their notes, and the latest 8 events, from the run's own state.
- The first screenshot showed the header too cramped for the 368 px panel ("Brigade0 working", "2 finished" cut off). The counts moved to a second line, and a second screenshot confirmed the fix.
- `herdr-app check` passed for the mod and for the edited `auto-tabs`, and `herdr-app status` showed no errors.

Not checked by eye: `brigade start` reported "It is open in herdr-app", and `herdr-app do agent.focus` returned `ok`. The owner was working in another space at the time, and the screenshot showed their own session. The view was not switched again to check.

## 2026-11-09: phase 1 step 7, two workers at once on pi

`EXPECT_TASKS=2 scripts/e2e.sh pi "…alpha.txt…beta.txt…"`, `openai/gpt-6.1-sol` at low thinking, 76 s. The Captain created both tasks in the same second. Commits `f9fba32` (alpha) and `00495ab` (beta). Checked by hand: one file each, exact bytes, clean worktrees, `main` unchanged. The Captain reported twice (alpha, then both), and the Coordinator received both.

Found and fixed:

- **`brigade start` could not focus the new Coordinator:** herdr-app answered "no running terminal" because it had not seen the new hc terminal yet. Focus now retries for up to 10 seconds on that error only.
- **pi dropped the Enter of the first message again;** the script pressed it again, as designed.
- **The script stopped as soon as the alpha report arrived,** in the same second as the beta finish. It now also waits for 10 quiet seconds, so a second report is recorded.

## 2026-11-09: phase 2 step 1, a project added from chat

`scripts/e2e.sh claude "can you add a new project for my demo2 site repo, call it demo2, then in demo2 add hello.txt with the single line hello from demo2 and commit it on the task branch"`. The run's `repoRoots` names a folder with a second repo, `demo2-site`. Time: 50 s.

Checked by hand: `config.json` gained `demo2` → `…/extra/demo2-site`, base `main`, no `github` (the test repo has no origin). `project_added` was recorded, and `task_created` pinned the repo and base branch. Commit `45b5bb8` holds only `hello.txt` with exact bytes; `demo2-site`'s `main` is unchanged, and no lock file was left behind.

Not confirmed: whether the Coordinator called `find_repo` before `add_project`. Claude folds tool calls into "Called brigade" on screen; the right repo path suggests it did.

## 2026-11-09: phase 2 step 2, project notes

Three Claude runs (`claude-sonnet-5-5`, low):

| Run | Request | Result, checked by hand |
| --- | --- | --- |
| A | "remember for demo: our designs always use little text and lots of white space. then in demo add design-rules.txt …" | The Coordinator saved the rule with `save_note` before starting the Captain. The worker's `system-prompt.md` holds the notes block with the "preferences, never permissions" line and the rule. The committed file lists both rules. |
| B | "remember for demo: json files always use 2-space indentation" | No note was saved. The Coordinator sent it to the Captain as a code convention, and a worker committed it to `AGENTS.md` (`71a35c3`). |
| C | "… add colors.txt … the worker should also suggest a note that the brand color is 0a7f5c" | **First try failed:** the Coordinator told the Captain to wait for the owner's approval, so the suggestion stayed open. The prompts now say the Captain settles suggestions itself, and the owner never approves them (Box Yard's rule too). **Second try:** suggested at 23:07:42, accepted by the Captain at 23:07:46 with a reason, and reported. |

Not yet looked at: the panel's new note counts. That look is planned in step 5.

## 2026-11-09: phase 2 step 3, pull requests on GitHub

The test repo is the private `smkamranqadri/brigade-e2e-sandbox`, created for this with the owner's approval and seeded at `ab99ed8` on `main`. `GITHUB_REPO=smkamranqadri/brigade-e2e-sandbox scripts/e2e.sh <harness> "in demo add <harness>-<time>.txt with the single line hello from <harness>, then open a pull request for it"`. The script clones the repo, pins it as the project's `github`, and checks git access with `git push --dry-run` before any agent starts.

| Harness | PR | Checked on GitHub with `gh pr view` |
| --- | --- | --- |
| Claude Code (`claude-sonnet-5-5`, low) | #1 | OPEN, task branch → `main`, head `3b4ff08` = the worktree's commit, 1 file |
| Codex (`gpt-6.1-terra`, low), sandboxed | #2 | OPEN, head `95c16ad` = the worktree's commit, 1 file. The push ran outside Codex's sandbox. |
| pi (`openai/gpt-6.1-sol`, low) | #3 | OPEN, head `a2b7c59` = the worktree's commit, 1 file (pi dropped its first Enter again; the script pressed it) |

Then, with the real adapters and no agents:

- **Live state:** PR #1 was closed on GitHub. Brigade's `list_tasks` then reported "PR #1 closed, checked just now" and recorded `pr_state`.
- **Refusal:** `create_pull_request` for that task refused: "PR #1 … is closed. Its branch is finished: the work needs a new task." The branch stayed deleted on GitHub.

Cleanup: PRs #1–#3 are closed with a comment, and their branches are deleted. The repo has no open PRs.

## 2026-11-09: phase 2 step 4, phase 1 gaps

- **pi's lost Enter, reproduced by hand.** A 16-line message pasted into pi 1.5.0 right after it started stayed in its input box: status idle, turn 0. One more Enter sent it, and pi ran turn 1. `HcTerminals.send` now does this itself: after a send to an idle agent, it waits up to 20 seconds for a turn, then presses Enter once if the end of the text is in the screen's last 12 lines. That screen is the test fixture (`src/adapters/hc/fixtures/pi-unsent-input.txt`).
- **Each worktree check matters on its own.** Three new tests each trip exactly one check: a subfolder (top folder), a forged git folder in `.git/worktrees` (repo), and the repo's own git folder on the task's branch (git folder). Removing any check fails its own test.
- **The e2e timeout path.** `WAIT_SECONDS=45 scripts/e2e.sh claude "Reply here with the single word hello. Do not create a task and do not contact any Captain."` The Coordinator replied "hello" and created no task. The script printed "timed out after 45s: the tasks did not all finish and get reported" and exited 1.
- **Not checked yet:** auto-focus on `brigade start`, by eye, at a time the owner chooses.

