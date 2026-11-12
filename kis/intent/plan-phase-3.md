# Phase 3 plan: resume, a Brigade space, and a TUI

Status: approved by the owner on 2026-11-11. 3a is done (planned below). 3b is done (`kis/intent/plan-phase-3b.md`). 3c gets its own KIS plan and review before work starts.

## Goal

The owner works with brigade like any other agent session:

- The Coordinator and the Captains keep their conversations across a stop or a reboot.
- `brigade start` opens a Brigade space. The Coordinator is in the first pane, and a brigade TUI with workers, tasks, PRs, notes and events is in a split pane beside it. Each Captain has its own tab.
- Brigade does not depend on herdr-app mods. A Workspace port places agents, with herdr-app (through `hc`) as the first adapter. The Herdr TUI and tmux can follow.

## Order

1. **3a Resume.** Each Coordinator and Captain runs in its own folder and continues the newest session there. It ships alone.
2. **3b Brigade space.** A Workspace port and its herdr-app adapter. `brigade start` makes or finds the space. The Coordinator and the Captains get tabs. Closing the space stops them.
3. **3c TUI.** A brigade TUI pane replaces the herdr-app panel, and the mod is removed.

## 3a Resume

### Facts this rests on

Checked on 2026-11-11 with `--help` and probes in scratch folders, without model calls:

| Harness | Continue the newest session in this folder | When there is none |
| --- | --- | --- |
| Claude 2.1.322 | `claude --continue` | Prints "No conversation found to continue" and exits. |
| pi 1.5.2 | `pi --continue` | Starts a new session. |
| Codex 0.167.1 | `codex resume --last` | Starts a new session. |

- Codex writes its session file only after the first message. Its MCP servers get no session id variable. So brigade stores no ids: each agent gets a folder of its own, and "the newest session in this folder" is always that agent's.
- The Coordinator already runs in `<stateDir>/coordinator`. Only brigade uses it.
- A Captain runs in the project's repo today, where the owner's own sessions also live.

### Scope

- A Captain runs in `<stateDir>/captains/<project>`, not in the repo. It can still read the repo:
  - Claude gets `--add-dir <repo>`.
  - Codex's read-only sandbox already reads any folder. pi has no read limits.
  - The Captain prompt tells the Captain to read the repo's `AGENTS.md` (or `CLAUDE.md`) before it plans work.
- Every Coordinator and Captain start continues the newest session in its folder. Workers start new, as now.
- If Claude prints "No conversation found to continue", brigade starts it once more without `--continue`.
- A Captain started for a Coordinator request still gets that request as its first message.
- `brigade start --new` starts the Coordinator in a new conversation.

### Out of scope

- Workers. A worker's conversation ends with its task.
- Session ids, and reading any program's private session files.
- Moving the owner's old Captain sessions out of the repos. A Captain's first start after this change is new, once.

### Tasks

- [x] **T1 Launch request.** Add `resume: boolean` and `readDirs: readonly string[]` to `AgentLaunch` (`src/application/launch.ts`) and to `HarnessLaunchRequest` (`src/application/ports.ts`). `launchAgent` passes both on. Workers get `false` and `[]`. Tests check the exact request for each of the three roles.
- [x] **T2 Harness flags.** Claude adds `--continue` and one `--add-dir` per read folder. pi adds `--continue`. Codex runs `codex resume --last` with its other flags. Each harness also gives the text it prints when it finds no session: Claude's is "No conversation found to continue", and pi and Codex have none. Contract tests go in `src/adapters/harness/harnesses.test.ts`.
- [x] **T3 Captain folder.** A new port, `Folders`, has one method, `ensure(path)`: it makes the folder with mode 0700 if it is missing. `src/entrypoints/bootstrap.ts` builds it, next to a new `captainsFolder` in `Deps`. `startCaptain` (`src/application/coordinator.ts`) calls `ensure` on `<captainsFolder>/<project>`, then runs the Captain there with the repo as a read folder. A test checks that the folder is made before the launch.
- [x] **T4 Resume on start.** `startCoordinator` and `startCaptain` launch with `resume: true`. `brigade start --new` (`src/entrypoints/cli.ts`) launches the Coordinator with `resume: false`. If a Coordinator is already running, `--new` refuses: "A Coordinator is running in <address>. Stop it with `hc kill <address>`, then run `brigade start --new` again." A CLI test covers the refusal.
- [x] **T5 Fallback.** `answerTrust` gets a fourth result, `no_session`. The hc adapter returns it when the terminal ends before it is ready and its screen shows the harness's no-session text. Then `launchAgent` (`src/application/launch.ts`):
  1. removes the ended terminal with hc, so its name is free;
  2. launches once more with `resume: false`, and records `agent_started` for the new terminal before it can act;
  3. gives the first message, such as a Captain's request, to the new launch only, so it arrives once.

  A second `no_session` or any other early end is an error, as now. Tests cover one retry only, a failed retry, an unrelated early end, and one delivery of the first message.
- [x] **T6 Captain prompt.** `prompts/captain.md` says that the Captain runs in its own folder, gives the repo path, and tells it to read the repo's `AGENTS.md` or `CLAUDE.md` before it plans.
- [x] **T7 Docs.** `docs/herdr-app.md`, `README.md`, `CHANGELOG.md` (Unreleased) and `docs/decisions.md` (why folders and not ids).

### Acceptance checks

- `npm run gate` passes, with the output in the task proof.
- Mutation checks: break the resume flag, the read folder and the fallback rule one at a time, and see a named test fail each time.
- Live, Claude (about 4 short model calls; the owner approves the model first):
  1. `brigade start --new`, tell the Coordinator a word, stop its terminal with `hc kill`, run `brigade start`, and ask for the word.
  2. Send a Captain a request, stop it, send it another, and see that it remembers the first.
  3. Check that the Captain reads a file in its repo without a permission prompt.
  4. Stop the Coordinator, run `brigade start --new`, and see that it does not know the word.
- Live, Codex and pi (about 4 short model calls, 2 per harness): repeat checks 1 and 2 with the Coordinator and Captain on that harness. Each time, check that the agent becomes ready, that a Captain gets the new request once, and that a brigade tool works from the resumed agent.
- Live, no model call: in an empty Coordinator folder, `brigade start` falls back and starts a new Claude conversation.
- `docs/e2e-runs.md` records every live run, with what was checked by hand.

### Risks

- Claude deletes sessions older than its `cleanupPeriodDays` (30 days by default). Then `--continue` finds nothing, and T4 starts a new conversation.
- A resumed conversation can hold old facts about tasks. The prompts already tell agents to read state through tools, not from memory.
- A conversation that grows for weeks relies on each program's own compaction. `brigade start --new` is the way out.
- The ready check (`TrustPrompt.ready`) may see a resumed screen differently from a new one. Live check 1 covers Claude.

## 3b Brigade space (outline)

- A Workspace port in `src/application/ports.ts`: make or find the Brigade space, give a terminal a tab, put a terminal beside another, select a terminal, and show a worker briefly.
- An herdr-app adapter: `herdr-app ls`, `space.new`, `space.select`, `terminal.keep` (`place` tab or right), `tab.select` and `terminal.peek`. Agents still launch through `hc` with brigade's labels.
- To check live first: whether `terminal.keep` lands in the selected space, what a reboot leaves in the space, and whether `space.close` ends kept terminals.

## 3c TUI (outline)

- A `brigade tui` program shows what the panel shows now and opens an agent through the Workspace port.
- The owner decides on a TUI library (a new dependency) or plain terminal codes before 3c starts.
- Removing the mod deletes `mod/`, `brigade mod install` and its docs. The owner approves the deletion. The owner's `brigade.toggle` and `alt-escape` keys lose their use.

## Review

- Reviewed: 2026-11-11 by codex GPT-6.1-Sol (medium); plan hash d515be9f23f9
- [fixed] T4 fallback could not see Claude's early exit: `answerTrust` had no such result - `no_session` result from the hc adapter, with the text from the harness (T2, T5).
- [fixed] Making the Captain folder in application code would do file I/O there - a `Folders` port with `ensure(path)`, built in bootstrap (T3).
- [fixed] `--new` could not start a new conversation while a Coordinator runs - it refuses and names the `hc kill` step (T4).
- [fixed] The plan skipped `AgentLaunch` between the use cases and the harness - T1 adds the fields there, with exact-request tests per role.
- [fixed] Retry lifecycle was unclear - T5 frees the name, records `agent_started` for the new terminal, and delivers the first message once, with tests.
- [fixed] No live check of Codex and pi resume, against the compass - the owner added live checks for both, and for `--new`.
