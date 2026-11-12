# Plan: tabs for Captains and workers, and worker resume

Status: done 2026-11-12. Scope approved by the owner on 2026-11-12. Follows phase 3b (`kis/intent/plan-phase-3b.md`).

## Goal

The Brigade space holds only the Coordinator, so the owner finds it at once. Each project's Captain and workers get tabs in that project's space. A worker whose tab was closed can be resumed, so closing a tab only pauses it.

## Decisions (the owner's, 2026-11-12)

- The Brigade space holds only the Coordinator. 3c adds the TUI pane there.
- A Captain or worker tab goes in the project's space: the first space, in herdr-app's order, whose folder is exactly the project's repo. A subfolder does not count. When none matches, brigade makes a space named after the project, with the repo as its folder.
- A Captain gets its tab when it starts. Brigade then shows the space and tab the owner was on.
- If the Captain's tab fails, the Captain still runs and gets its request. The Coordinator's tool reply says that the tab failed. The owner gets the tab from `brigade start` or a panel click.
- `brigade start` gives each running Captain without a tab a tab in its project space. The Coordinator tab is shown last, as now.
- A click on a task row in the panel:
  - When its worker runs, brigade shows the worker's tab, or makes one in the project space. Brigade stays on that tab.
  - When its worker has ended, brigade resumes the worker, then makes its tab.
  - When the project's Captain is not running, brigade refuses: "Start the <project> Captain first: ask the Coordinator."
- A Captain's follow-up to an ended worker (`send_to_task`) resumes the worker first, then sends the follow-up. The same Captain rule applies: the Captain is the one asking, so it runs.
- Tabs that already exist are not moved. The Captain tabs now in the Brigade space stay until the owner closes them.

## How a worker resumes

- A worker's folder is its task's worktree, and no other agent runs there. So, as for Captains in 3a, brigade continues the newest session in that folder. It stores no session ids.
- Brigade resumes a worker only when its task's worktree is still that task's worktree, on that branch, as the commit check does today. Otherwise it says the worktree is gone.
- The resumed worker gets the task's own model and limits (`TaskView.spec`) and write folders from the task's pinned repo (`TaskView.repo`), never the current worker defaults or the project's current repo. A task with no pinned repo (from before phase 2) is refused.
- Its parent is the running Captain. It starts with `--outlive-parent`, as workers do now.
- One resume runs at a time per task, across processes: a lock file in the state folder covers the check, the launch and the ready wait. Inside the lock, brigade checks again that the worker is not running. So a click and a Captain follow-up never start two workers.
- It gets no first message: the brief is in its old conversation. Brigade does not store the brief.
- If Claude finds no conversation to continue, brigade removes the ended terminal and refuses: a new conversation would have no brief. It does not retry without `--continue`, as it does for the Coordinator and Captains.
- If the resumed worker never becomes ready, brigade removes its terminal, so the next try starts clean.
- A new event, `worker_resumed`, holds the new terminal address. The task record takes it, because `list_tasks` reads the address from there. The panel finds workers by their labels, as now.
- If the tab fails after a resume, the worker keeps running. The reply says it runs without a tab, and the next click shows it without a second resume.

## Facts this rests on

| Fact | Source |
| --- | --- |
| `herdr-app ls` gives each space's `folder` and marks the shown space and each space's shown tab with `active`. | `herdr-app ls` on 2026-11-12 (0.1.15) |
| Several spaces can share one folder, and space names differ from repo names. | Same |
| `terminal.keep` makes the tab in the shown space, so brigade must show the target space first. | 3b T0 |
| Closing a tab or a space ends its terminals and their sub-agents. | 3b T0 and live check 6 |
| A Captain starts inside the Coordinator's MCP server process (`sendToCaptain`, `src/application/coordinator.ts`). | Code |
| Workers are found by the labels `role` and `task` (`findTerminals`). | Code |
| `space.select` and `tab.select` show a space and a tab. | 3b T0 |
| Whether `space.select` and `tab.select` restore the exact view, also when the owner was in another space. | **To probe in T0** |
| Claude, Codex and pi each find a worker's session in its worktree with their 3a resume flags. | **To check live**: only the Coordinator and Captains were checked in 3a. |

## Scope

- [x] **T0 Probe.** Live, no model calls, in a space named `brigade-probe`. The owner approves each command that acts on the window. Check: the `active` marks match what the window shows; `space.select` then `tab.select` brings back a view in another space; a tab can be made in a space that is not shown, with `space.select` first. Record the results in `docs/herdr-app.md`. Stop and replan if the view cannot be restored.
- [x] **T1 Workspace port.** `open(address, options)` in `src/application/ports.ts` takes a place `{name, folder}`, `first`, and `returnToView`. It finds the space by folder only, the first match in herdr-app's order, and makes it with that name when none matches. With `returnToView`, it shows the owner's earlier space and tab at the end, also when a step fails. This is best effort: a closed tab or space is skipped, and an error while restoring is reported together with the first error. The Brigade space is the place with the Coordinator folder.
- [x] **T2 herdr-app adapter.** `HerdrAppWorkspace` (`src/adapters/herdrApp/herdrApp.ts`) implements T1. It reads the shown space and tab from `ls` before it acts. The wrong-space check and the shell-tab close of 3b apply in every space. Tests use the `ls` fixture builder, with two spaces that share a folder, with no match, and with a failure after each step that changes the view.
- [x] **T3 Workspace in the MCP server.** `Deps` gets the Workspace, so the MCP server can make a Captain's tab. `src/entrypoints/bootstrap.ts` builds it lazily: a missing herdr-app fails only the call that needs it, so workers' tools still work without it. `openBrigade` and `openAgent` take it from `Deps`. Every `open` is followed by `keepOff`, also when it fails, as in 3b (`openTab`).
- [x] **T4 Captain tabs.** `startCaptain` opens the Captain's tab in its project space with `returnToView`, then turns core keep off. A tab failure is added to the tool's reply and does not fail the request. `openBrigade` looks up the running Captain of each configured project and opens it in that project's space. A Captain of a project no longer in the config gets no tab. Tests against fakes cover the place, the return, and a failed tab.
- [x] **T5 Worker resume.** A new use case resumes a task's worker, as set out in "How a worker resumes". `launchAgent` gets an option to refuse on `no_session` instead of retrying. `Worktrees` gets a check that the task's worktree is still in place. Tests cover: a running worker (no resume), no Captain, a missing worktree, no pinned repo, `no_session`, a worker that never becomes ready, two resumes at once, changed worker defaults and a changed project repo (the exact launch request and write folders), and the event.
- [x] **T6 Open a task.** `brigade open <task id>` (`src/entrypoints/cli.ts`) shows the worker's tab in the project space, and resumes the worker first when it has ended. Brigade stays on that tab. Coordinator and Captain addresses work as now.
- [x] **T7 Follow-up.** `sendToTask` (`src/application/captain.ts`) resumes an ended worker, then sends. Its reply says the worker was resumed.
- [x] **T8 Panel.** In `mod/main.js`, a click on a task row or rail cell runs `brigade open <task id>`, also when the worker has ended. A task open may take longer than the 30 s limit for other opens, so it gets its own limit, and repeat clicks on the same row are ignored while it runs. Peek stays only as the fallback for a `config.js` from before `OPEN`. Fix the rail's `open` name, which a task list of the same name hides, and check the rail clicks in the window. The owner runs `brigade mod install` again.
- [x] **T9 Docs.** `README.md`, `CHANGELOG.md` (Unreleased), `docs/herdr-app.md`, `docs/decisions.md` (project spaces, worker resume by folder, and the Codex and pi resume risk), `SECURITY.md` (that risk as a known limit) and the Captain prompt, if it names the old "start a new task" answer.

## Out of scope

- Moving tabs that already exist.
- Workers whose Captain is not running: the backlog item "Workers report to a Captain that has restarted".
- Resuming a worker in a new conversation with its brief.
- The TUI (3c).

## Acceptance checks

- `npm run gate` passes, with the output in the task proof.
- Mutation checks: the folder match, the made space's name, `returnToView` (also after a failure), the Captain tab failure path, each refusal of the worker resume, the `no_session` refusal, `--outlive-parent` and the parent of a resumed worker, and the resume in `sendToTask`. A named test fails each time.
- Live, on Claude (about 4 short model calls; the owner approves the model first), in a test config with a scratch repo:
  1. A Coordinator request starts a Captain. Its tab appears in the project space, and the owner's view comes back.
  2. With no space for the repo, brigade makes one named after the project.
  3. A task row click opens a running worker's tab and stays there.
  4. The worker's tab is closed. A click resumes it, and it still knows its task.
  5. The worker's tab is closed again. A Captain follow-up resumes it, and the worker answers.
  6. A click with no Captain running refuses with the message.
  7. A click and a Captain follow-up at the same time start one worker.
  8. `hc get` shows core keep off on every brigade terminal after each step.
- Not checked live: Codex and pi worker resume. Unit tests cover their flags; the risk is recorded below and in `SECURITY.md`.
- `docs/e2e-runs.md` records every live run, with what was checked by hand.

## Risks

- The view jumps to the project space for a moment when a Captain starts. If the owner clicks or types then, the wrong-space check fails the tab, and the Captain still runs.
- Brigade makes a space named after the project when no space has the repo folder. A space with that name but another folder is not matched, so two spaces can share a name.
- Closing a project space ends its Captain and workers. The Captain resumes on its next request; each worker resumes on a click or a follow-up.
- Codex and pi start a new conversation when they find no session, and they don't say so. A resumed Codex or pi worker whose session was deleted would then run without its brief. Brigade does not read their private session files to check. The owner accepted this risk on 2026-11-12. T9 records it as a known limit in `SECURITY.md` and `docs/decisions.md`, as the MCP gaps are recorded.

## Review

- Reviewed: 2026-11-12 by codex gpt-6.1-sol (medium); plan hash 3f56b8d8f150
- [fixed] A click and a Captain follow-up can resume the same worker at once - a lock file per task covers the check, launch and ready wait, with a recheck inside (How a worker resumes, T5, check 7).
- [rejected] Codex and pi may resume a worker without its brief - the owner accepted the risk on 2026-11-12; it is recorded in Risks and, by T9, in `SECURITY.md`.
- [fixed] Core keep cleanup was explicit only for Captain tabs - every `open` is followed by `keepOff`, also when it fails (T3).
- [fixed] A resume could use the current worker defaults or a changed repo - it uses the task's spec and pinned repo, and refuses a task with none (How a worker resumes, T5).
- [fixed] `list_tasks` reads the task's terminal address - `worker_resumed` holds the new address and the task record takes it.
- [fixed] Restoring the view had no failure rule - best effort, closed tabs skipped, both errors reported (T1, T2).
- [fixed] A resumed worker whose tab fails was unclear - it keeps running, the reply says so, and the next click reuses it.
- [fixed] The panel's 30 s open limit is shorter than a resume - task opens get their own limit, and repeat clicks are ignored (T8).
- [fixed] Building the Workspace in `buildDeps` fails every MCP server without herdr-app - it is built lazily (T3).
- [fixed] `TerminalInfo` has no project, so Captains can't be mapped to spaces - `openBrigade` looks up the Captain of each configured project (T4).
- [fixed] A resumed worker that never becomes ready stays as a running terminal - brigade removes it (How a worker resumes).
- [fixed] The rail's `open` helper is hidden by a task list of the same name - T8 fixes it and checks the rail clicks.
