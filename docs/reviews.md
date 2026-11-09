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

## Phase 2 plan review (2026-11-09, before any code)

Reviewer: Codex CLI, `gpt-6.1-sol` at medium effort, read-only, on `docs/plan-phase-2.md` as first written (`12f159d`), checked against the code, the guide and the installed tools. 14 findings: 7 blocking, 7 suggestions. All were checked and taken into the revised plan:

| ID | Finding | Change to the plan |
| --- | --- | --- |
| R1 | Check-then-rename can lose a concurrent config change (handlers run in parallel) | A cross-process lock around read, validate and write, with a two-writer test |
| R2 | "A worker called the tool" is not the owner's permission to push | Publishing off by default; only the owner turns it on, per project |
| R3 | An accepted suggestion could turn repo text into a lasting instruction | Notes carry their source, are fenced as preferences, and can't unlock anything because power is enforced in code |
| R4 | Note and suggestion ids had no project check | Every id checked against the caller's project, with negative tests |
| R5 | Local checks didn't pin the GitHub repo or the pushed ref | A pinned `github` repo per project, a checked push URL, an explicit refspec and `--repo/--head/--base` on every `gh` call |
| R6 | No recovery after a crash, and a merged PR's branch could be pushed again | Reconcile with GitHub before every publish; refuse merged or closed PRs |
| R7 | The budget silently dropped rules, against the goal | Owner's decision: recommended no silent drops |
| R8 | Accepting a suggestion took two events | One resolution event, first one wins |
| R9 | Fresh config needed snapshot and pinning rules | One snapshot per call; tasks pin repo and base branch |
| R10 | Discovery, push and `gh` lacked full limits | Limits, no prompts, an overall deadline and shared refresh |
| R11 | Merging "by asking a worker" doesn't work on sandboxed Codex | GitHub is the supported merge path this phase |
| R12 | No mutation plan for new guards; the notes example was a code convention | A proof matrix; the notes example is now a preference |
| R13 | Approving the repo doesn't prepare the test fixture or git credentials | Seeded repo, pinned identity, `git push --dry-run` before runs |
| R14 | A project with notes but no agents would not show in the panel | The panel reads projects from the config |

## Phase 2 steps 1 to 4 (2026-11-09)

Reviewer: Codex CLI, `gpt-6.1-sol` at medium effort, read-only, on `d9d4ee8..cf95e84`, without the implementer's summary. 9 findings: 7 blocking, 2 suggestions. Each was checked against the code (R1 also with a scratch repo) before it was fixed, and each fix was mutation-checked.

| ID | Finding | Fix |
| --- | --- | --- |
| R1 | git rewrites a checked URL again when it pushes, so an `insteadOf` rule could send the push elsewhere | A rewrite rule that matches the push URL is refused (`81fe599`) |
| R2 | `push.followTags` could push tags with the task branch | The push names `--no-follow-tags` and `--recurse-submodules=no` (`81fe599`) |
| R3 | A refused origin URL showed any password in it | Refusals show the URL without credentials (`81fe599`) |
| R4 | A late reaper could delete a successor's config lock | Locks are moved aside and put back if they changed; a writer that lost its lock drops its change (`e9baf55`) |
| R5 | A crash between creating the lock and writing it blocked writes for good | The lock is created with its content in one step; an unreadable lock is aged by its file time (`e9baf55`) |
| R6 | The extra Enter could send the owner's own edit | Enter only when the box between the last two rules holds exactly brigade's message (`7efd70c`) |
| R7 | A merge could overwrite a note changed meanwhile | The merge records the text it was based on; otherwise the suggestion stays open, in both folds (`5ef0d54`) |
| R8 | PR refresh could take 40 seconds and starve a ninth PR | A 15-second deadline, and least recently asked first (`389f306`) |
| R9 | The config fake accepted a config the file store refuses | Both use one check, `checkedChange` (`e9baf55`) |

Found while fixing R1 to R3: commit and push run outside the agent's sandbox, so git hooks ran there too. A hook manager such as lefthook reads its commands from the worktree, which the agent writes. Brigade's git calls now run with `core.hooksPath=/dev/null`, and the worker prompt says to run the repo's checks itself (`81fe599`).

The reviewer also noted that the proof matrix claimed a test for each protected config field, but the test covered only `github`. A test for `owner`, `roles` and `repoRoots` on both project tools is added. The lock test uses two store instances in one process: each has its own queue, so they contend only through the lock file, as two processes do.

The reviewer could not run vitest in its read-only sandbox (`EROFS` on `node_modules/.vite-temp`). The implementer ran the gate after the fixes: 227 tests pass.

