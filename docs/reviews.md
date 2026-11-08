# Reviews

## Phase 1, steps 2 and 3 (2026-11-08)

Reviewer: Codex CLI, `gpt-6.1-sol` at medium effort, read-only sandbox. It read `REVIEW.md`, the plan, `AGENTS.md`, the architecture note, the engineering guide and the diff `ee8c506..0d326c3`, but not the implementer's summary (guide W5).

Each finding was checked against the code before it was fixed. Each fix has a test, and each test was mutation-checked: undoing the fix makes that test fail, and the file was restored byte for byte (guide T7).

| ID | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| R1 | blocking | A worker's report could be logged before its `task_created` event, and then be dropped. | Fixed. `launchAgent` records the start event as soon as the terminal exists, before the trust wait. |
| R2 | blocking | A trust-prompt timeout was reported as a successful launch. | Fixed. `answerTrust` returns `answered`, `ready` or `timeout`; a timeout fails with the terminal's address. |
| R3 | blocking | A half-written last line in the event log broke every later read. | Fixed. An append after a fragment starts on a new line, and a read skips and reports damaged lines. |
| R4 | suggestion | A follow-up left a task as "asking" or "finished". | Fixed. A message to the worker puts the task back to "working". |
| R5 | suggestion | A JSON `null` line could crash an agent's MCP server. | Fixed. The server answers non-requests with Invalid Request and failures with Internal error, and keeps serving. |
| R6 | suggestion | The suppression count missed casts and config exemptions (guide C11, Q4). | Fixed. It now counts both. Six avoidable casts were removed; the baseline is 9 (4 `JSON.parse` casts at file and `hc` borders, 5 config exemptions). |

The reviewer could not run coverage or the two file-system adapter suites inside its sandbox, and ran no real agents. The implementer ran the full gate and both real-agent runs (`docs/e2e-runs.md`).

## Phase 1, steps 4 to 6 (2026-11-09)

Reviewer: Codex CLI, `gpt-6.1-sol` at medium effort, read-only sandbox, on the diff `cb6362e..fbab81d`, without the implementer's summary. Each finding was checked against the code before it was fixed.

| ID | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| R1 | blocking | The `commit` tool trusted whatever git found in the worktree. A worker that switched branch got a commit on that branch, reported as the task branch; one that edited its `.git` file could aim the commit, which runs outside the sandbox, at another repo. | Fixed. Before staging, brigade checks the worktree's top folder, the repo its git folder belongs to, that the git folder is one of that repo's worktrees, and the branch, all against its own records. Then it pins git to that folder. Three rejection tests (switched branch, another repo, a sibling task's worktree). Only the branch check was mutation-checked (two tests fail without it). The top-folder, repo and git-folder checks were not mutation-checked one by one; in the tests they overlap, so a test for each alone is still to do. |
| R2 | blocking | `scripts/e2e.sh` could send its test request to the owner's real Coordinator if one started in the same seconds, and an `hc ls` failure fell through. | Fixed. An `hc` failure stops the script; it needs a newly started Coordinator and takes its address from the run's own event log. Checked: with a live `brigade=main` terminal, the script refused and created nothing. |
| R3 | blocking | The e2e script exited 0 on timeout. | Fixed: it exits 1 with a reason. Not run, because a timeout run costs model usage. |
| R4 | suggestion | The test fake dropped the first message unless told to type it in. | Fixed: it delivers the message once, in argv or typed in, as the contract requires. Kept as is: the routing-role contract test still uses a containment check, because each harness also has an exact-argv test. |

The reviewer could not run the tests in its read-only sandbox (Vite needs a temp folder) and started no agents. The implementer ran the full gate.
