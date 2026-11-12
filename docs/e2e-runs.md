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
- **Auto-focus** was checked later the same day (see the last section).

## 2026-11-09: phase 2 step 5, final runs on each harness

One request per harness, against the GitHub test repo: "Three things. First, add the repo demo2-site as a project called demo2. Second, remember this for demo: designs use little text and lots of white space. Third, in demo add <harness>-final-<time>.txt with the single line hello from <harness>, then open a pull request for it." Each was checked from outside the agents: the run's `config.json`, the worker's instructions, and `gh pr view`.

| Harness | Time | Project added | Note in the worker's instructions | PR, head = the worktree's commit |
| --- | --- | --- | --- | --- |
| Claude Code (`claude-sonnet-5-5`, low) | 113 s | demo2, no GitHub repo | Yes (`system-prompt.md`) | #4 OPEN, `03b633a`, 1 file |
| Codex (`gpt-6.1-terra`, low), sandboxed | 108 s | demo2, no GitHub repo | Yes (`developer_instructions`) | #7 OPEN, `35c44c0`, 1 file |
| pi (`openai/gpt-6.1-sol`, low) | 104 s | demo2, no GitHub repo | Yes (`system-prompt.md`) | #6 OPEN, `a8acdad`, 1 file |

- **The first Codex run used another note: "text files end with one newline".** The Coordinator took it as a code convention, and the worker added it to the repo's `AGENTS.md` (PR #5, `436f8a4`, 2 files), as the prompts say. Claude saved the same words as a note. Both readings fit the prompts, so the final runs use a clear preference.
- **The e2e script pressed Enter into a working Coordinator.** It counted only finished turns, so Claude's first turn, still running after 20 seconds, looked unstarted. It now counts a working agent as started (`d937d4d`). In the pi run, pi dropped its first Enter again, and the script pressed it once.
- **The panel**, pointed at the Codex run's state, showed the demo project with 1 note, demo2 with 0 notes (from the config, with no agents), and the task's "PR #7 open" chip. The first screenshot showed the chip squeezing the task's title to an ellipsis, and "1 notes". The chip moved to the second line (`4045cb6`); a second screenshot confirmed the fix. The panel and the mod's config were restored afterwards, the config byte-identical.

Cleanup: PRs #4 to #7 are closed with a comment and their branches deleted. The repo has no open PRs and only `main`.

## 2026-11-09: auto-focus on `brigade start`, checked by eye

The owner watched while `brigade start` started a Claude Coordinator in a test folder. `herdr-app do agent.focus` returned `ok`, but nothing changed on screen, and a screenshot showed the owner's own session. The Coordinator wasn't in the Agents sidebar either. brigade's agents run with no parent and no pane, so herdr-app has no tab to switch to and no list to put them in.

`herdr-app do terminal.peek` shows such a terminal over the current tab, with ↗ keep (make it a tab) and ✕. `brigade start` and clicks on panel rows now use it (owner's choice: peek only, no sidebar row). A second `brigade start` showed the Coordinator in the peek overlay, confirmed by a screenshot. A click on a panel row uses the same command but was not clicked by hand.

## 2026-11-09: the panel's Start button

The panel, pointed at a test config with no Coordinator, showed "No Coordinator is running" and a **Start brigade** button (screenshot). The owner clicked it: the button said "Starting…", then the Coordinator opened in the peek overlay, and the panel listed it. The run's event log recorded a new `agent_started` for that Coordinator (`t17q`). The Coordinator was then closed, its trust entry removed (with a backup), and the panel pointed back at the real brigade.

## 2026-11-09: the owner's first real use, and its fixes

The owner started a real brigade, added seven projects by chat, and asked for a status report on one. Three problems:

- **The Captain's answer never reached the Coordinator.** It answered in its own terminal; its prompt said to call `report` only for a worker's result.
- **Neither routing role can run a command,** so the Captain guessed the status from `.git` files, and the Coordinator couldn't list the owner's Herdr agents.
- **`add_project` took the checked-out branch as the base branch,** a feature branch in two of the repos.

Fixes: the Captain prompt routes every Coordinator request through `report`; new read-only tools `repo_status` and `herdr_agents`; the repo's default branch as the base. A real-git test of `repo_status` also found that the `git()` wrapper trimmed the first status line's leading space, so an unstaged file read as staged.

Real check (Claude, `claude-sonnet-5-5` low): `EXPECT_TASKS=0 scripts/e2e.sh claude "Ask the demo Captain which branch the demo repo is on, its latest commit, and what its README says. No worker is needed: the Captain can answer from the repo itself."` In 42 seconds the Captain called `repo_status`, read the README, and called `report`; the Coordinator received the report and passed it on. `brigade panel` opened the panel as a window, without the auto-tabs mod (screenshot), and closed it again.


## 2026-11-11: resume, Claude (phase 3a)

Run folder `run-resume-claude-20261111-134701`, every role on `claude-sonnet-5-5` low, driven by hand with `hc send` and `hc wait`.

- **Coordinator resume:** told it "PELICAN", stopped it with `hc kill`, ran `brigade start`. The new terminal ran `claude --continue` and answered "PELICAN".
- **Fallback, folder already trusted:** `--continue` found no session (`t1cw`), brigade removed that terminal and started a new one (`t1cx`).
- **Fallback, new folder (bug found and fixed):** in a folder Claude had not trusted yet, Claude asks about trust first, then ends with "No conversation found to continue". `answerTrust` returned "answered" once the prompt was gone, so brigade reported a start for an agent that had ended (`t1cv`). Fix: after a trust answer, wait for the ready text or the no-session text. Re-checked live with the new Captain folder: `t1cz` ended with no session and was removed, and `t1d1` started new.
- **Captain:** in `state/captains/demo`, it read the repo's `README.md` with no permission prompt in manual mode and reported "OTTER" and the README line. After `hc kill`, a new request started it with `claude --continue`. The request showed once on its screen, and it reported "OTTER".
- **`--new`:** refused while the Coordinator ran, naming `hc kill t1cy`. After the stop, it started without `--continue`, and the Coordinator answered "NONE" when asked for the word.

## 2026-11-11: resume, Codex and pi (phase 3a)

Run folders `run-resume-codex-20261111-140252` (`gpt-6.1-terra` low) and `run-resume-pi-20261111-140427` (`openai/gpt-6.1-sol` low), every role on that harness.

- **Codex:** the Coordinator ran `codex resume --last` from its first start, which began a new session in the empty folder. After `hc kill` and `brigade start` it answered "PELICAN". The Captain ran in `state/captains/demo`, read the repo's README and reported "OTTER" and the README line. After `hc kill`, a new request started it with `codex resume --last`. The request showed once, and it reported "OTTER". `~/.codex/config.toml` was unchanged.
- **pi:** the same steps with `pi --continue`, and both answers were right. The pi Captain also saved "OTTER" as a project note. So the restart check asked it to answer without tools: the resumed screen showed the earlier request, the new request showed once, and it reported "OTTER".
- pi dropped the Enter of text typed with a plain `hc send`. Brigade's own `send` already presses Enter again in that case, so this needed only a hand press in the test.

## 2026-11-11: the Brigade space (phase 3b)

Run folder `run-resume-claude-20261111-221605`, every role on `claude-sonnet-5-5` low, driven by hand. herdr-app 0.1.15, hc 0.1.20. Two model calls: the Coordinator and the Captain.

- **No space:** `brigade start` made a space named Brigade in the run's Coordinator folder and showed it. The Coordinator (`t1fb`) was alone in tab 1; the shell tab from `space.new` was gone.
- **Running Coordinator:** `brigade start` said "Already running" and changed no tab.
- **Captain:** a Coordinator request started the demo Captain (`t1ff`, parent `t1fb`, `die_with_parent` true) with no tab, and it reported "OTTER". `brigade open t1ff` gave it tab 2 and showed the space. After `terminal.park` took its tab away, `brigade start` gave it a new tab 2 and showed the Coordinator's tab 1 last.
- **Space closed (decision changed):** a labelled `sleep` worker under the Captain, with `--outlive-parent`, ended with the space, together with the Coordinator and the Captain. A probe with `sleep` terminals showed that herdr-app ends a terminal's sub-agents with it; a terminal with no hc parent survived. The owner chose to accept this (`docs/decisions.md`).
- **After the close:** `brigade start` made the space again, and the Coordinator continued its conversation (the OTTER exchange was on screen).
- **Coordinator tab closed:** the Coordinator ended and herdr-app removed the empty space. `brigade start` made both again and continued the conversation.
- **`hc kill` on the Coordinator:** herdr-app removed its tab and the space. `brigade start` continued the Coordinator in a new tab 1.
- **Core keep:** `hc get` showed `keep` false on every brigade terminal after each step.
- **Checked by hand:** each layout through `herdr-app ls`, and each terminal through `hc get`. The panel was not clicked: the installed mod points at the owner's real state.

## 2026-11-12: project spaces and worker resume

Run folder `run-resume-claude-20261112-144501`, Captain and worker on `claude-sonnet-5-5` low, driven by hand. herdr-app 0.1.15, hc 0.1.20. The owner's own brigade was running, so a `sleep` terminal stood in as the Captain's parent, and the use cases ran through a small script, as the Coordinator's and Captain's tools run them. One test Captain report reached the owner's real Coordinator (the owner accepted this). About 6 model calls: the Captain twice, the worker four times.

- **Captain tab at start:** a Coordinator request started the demo Captain (`t1m9`; its first start `t1m8` found no session and was started again, as in 3a). No space had the repo folder, so brigade made a space named `demo` with the Captain alone in it. The owner's view came back. On a later start (`t1mk`) the same happened.
- **Task open, running worker:** `brigade open task-9b5f17` opened worker `t1mc` in a tab in `demo` in about 1 s, and the view stayed there.
- **Resume on open:** the worker's tab was closed, which ended it. `brigade open task-9b5f17` resumed it as `t1mh` in a new tab, with its old conversation on screen. Asked the colour without reading again, it answered "Teal".
- **Resume on follow-up:** the tab was closed again. A Captain follow-up resumed the worker as `t1mj` (no tab, by design), and it sent "teal" to the Captain.
- **No Captain:** closing the Captain's tab ended the Captain and the worker, and herdr-app removed the empty space and showed another space. `brigade open` then refused: "Start the demo Captain first: ask the Coordinator."
- **Two opens at once:** one resume only (`t1mn`, one `worker_resumed` event). **Bug found:** the second open's `terminal.keep` returned no tab id, because the first had just made the tab, and it failed. Fixed in `ebc1a49`: it now finds the tab that holds the terminal. Run again: one resume (`t1mp`), both opens succeeded, one tab.
- **Core keep:** `hc get` showed `keep` false on every test terminal after each step.
- **Checked by hand:** each layout through `herdr-app ls`, each terminal through `hc get`, and the worker's screen through `hc read`. Codex and pi worker resume were not run.
- **Cleanup:** the `demo` space and the parent terminal were closed; no test terminal is left.
- **Panel, in the owner's real brigade (owner's clicks):** after `brigade mod install`, a click on a task row opened a running worker in its project's space, and a click on an ended worker's task resumed it and opened it there. The rail was not checked: it exists only in a layout column, and 3c replaces it.
- **Moving the owner's Captains:** `terminal.park` took the 5 old Captain tabs out of the Brigade space and left the Captains running. `brigade start` then opened each one in its project's space; the Brigade space kept only the Coordinator, and core keep stayed off.
