# Phase 3b plan: the Brigade space

Status: done 2026-11-12. Scope approved by the owner on 2026-11-11. Part of `kis/intent/plan-phase-3.md`.

## Goal

`brigade start` opens the Coordinator as a normal tab in a herdr-app space named "Brigade", not in a peek. Captains get tabs there too. Closing the space stops the Coordinator and its Captains.

## `brigade start` flow (the owner's)

```text
herdr-app and hc running?            no  -> stop: say which one is not running
  Brigade space exists?              no  -> make the space
    first tab holds the Coordinator? no  -> make a tab for it, move it first
      Coordinator running?           no  -> start it (resume), put it in that tab
        show the Coordinator tab
```

A tab needs a running terminal (`terminal.keep`), so brigade starts the Coordinator before it makes its tab. The owner sees the same result.

Then each running Captain gets a tab in the space, if it has none. The Coordinator tab is shown last.

## Decisions

- A Captain starts in the background. It gets a tab only on `brigade start`, or when the owner clicks it in the panel (`brigade open <address>`).
- A Captain ends when the Coordinator ends: it starts without hc's `--outlive-parent`. Workers keep the flag, so `hc kill` on a Captain leaves its workers running.
- Closing the Brigade space or the Coordinator's tab ends the workers too (owner's choice after live check 6): herdr-app ends a terminal's sub-agents with it, `--outlive-parent` or not. A worker's worktree, commits and file edits stay on disk.
- Captains that run before this change keep the old flag until they restart. The CHANGELOG tells the owner to stop them once with `hc kill`.
- Brigade makes the Coordinator tab with one pane. The owner may split it; brigade leaves it as it is.
- If an agent already has a tab, also outside the Brigade space, `open` shows that tab. Brigade does not move it.
- Brigade never closes or moves a tab it did not make, with two exceptions in the Brigade space: it moves the Coordinator tab to position 1, and it closes the shell tab that `space.new` makes.
- Core keep stays off on every brigade terminal (owner's choice after T0). `terminal.keep` turns it on, so brigade turns it off at once with `hc keep <t> --off` and reads it back. `brigade start` also turns it off on every brigade terminal, in case herdr-app turns it on again.

## Facts this rests on

Probed in T0 on 2026-11-11 (herdr-app 0.1.15, hc 0.1.20; details in `docs/herdr-app.md`), unless the source says otherwise.

| Fact | Source |
| --- | --- |
| `space.new {name, folder}` makes the space, shows it, and returns `{space, tab, terminal}`. Its tab 1 holds a shell. | T0 |
| `space.select` then `terminal.keep {terminal, place: "tab"}` makes the tab in that space, shows it, and adds the labels `herdr.space` and `herdr.tab`. | T0 |
| `terminal.keep` turns hc's core keep on. `hc keep <t> --off` turns it off, and the tab stays. | T0 |
| `tab.move {id, index}`, `tab.select {id}` and `tab.close {id, confirmed}` work. | T0 |
| `tab.close` and `space.close` end the terminals in them, kept ones too. | T0 |
| When a kept terminal with keep off ends, herdr-app removes its tab, and the space when that was its last tab. | T0 |
| A child terminal without `--outlive-parent` ends when its parent ends. | T0 |
| `space.close` also ends the sub-agents of its terminals (children started with `--parent`), even with `--outlive-parent`. A terminal with no hc parent survives. | Live check 6 and a probe |
| A Captain already starts with `--parent <Coordinator>` (`src/application/coordinator.ts:70`). | Code |
| `hc ls` lists only live terminals, so an ended Coordinator is not found as running. | `hc ls --help`; 3a live check 1 |
| What herdr-app does with kept terminals after a window restart or a reboot. | **Untested**: the owner's window must not restart. |

With core keep on, hc puts a shell where an agent was lost to a reboot. The owner's revive mod then resumes the agent there without brigade's tool limits. So core keep must stay off.

## Scope

- [x] **T0 Probe.** Live, with no model calls, in a space named `brigade-probe`. The owner approves each herdr-app and hc command that acts on the window or a terminal. Check every fact above that can be checked without a window restart or a reboot. Record the results in `docs/herdr-app.md`. Stop and replan with the owner if a fact is wrong, or if brigade cannot remove the shell tab that `space.new` makes.
- [x] **T1 hc changes.** In `src/application/ports.ts` and `src/adapters/hc/hcTerminals.ts`:
  - `TerminalLaunch` gets `outliveParent: boolean`. `launchOnce` (`src/application/launch.ts`) sets it to `role === "worker"`. The adapter adds `--outlive-parent` only when it is true. Tests check the launch request and the exact hc argv for each role.
  - `Terminals` gets `keepOff(address)`. It runs `hc keep <t> --off`, then reads the flag with `hc get`, and fails with a message if it is still on.
- [x] **T2 Workspace port.** In `src/application/ports.ts`:
  - `check()`: fails with a clear message when the window is not running.
  - `open(address, {first})`: shows the terminal's tab. If the terminal has no tab, it makes one in the Brigade space, and makes the space when it is missing. With `first`, a tab in the Brigade space moves to position 1. A tab in another space is shown and not moved.
- [x] **T3 herdr-app adapter.** `src/adapters/herdrApp/herdrApp.ts` implements the port with `herdr-app status`, `ls`, `space.new`, `space.select`, `terminal.keep`, `tab.move`, `tab.select` and `tab.close`. It finds the space by name "Brigade" and the Coordinator folder. After `terminal.keep`, it reads `ls` again. If the new tab is not in the Brigade space, it fails with a message and moves nothing. It closes the shell tab that `space.new` made only after the new tab is in the space: a space with no tabs is removed. Tests use a fake runner with `ls` output taken from a real run (fictional ids).
- [x] **T4 Use cases.** In `src/application/coordinator.ts`:
  - `openBrigade(deps, workspace, {fresh})` follows the flow above. It also checks that hc answers before it starts anything. At the end it calls `keepOff` on every brigade terminal.
  - `keepOff` runs on the terminal after every `workspace.open`, also when `open` fails. If `keepOff` fails, the error names the terminal and the command `hc keep <t> --off`.
  - The final `keepOff` sweep also runs when an earlier step fails. It tries every brigade terminal and reports all failures together.
  - Tests inject a failure in `open` and in `keepOff`, and check that the other calls still run.
  - `openAgent(deps, workspace, address)` opens a Coordinator or a Captain, and refuses any other terminal.
  - Tests against fakes cover each branch of the flow.
- [x] **T5 CLI.** `brigade start` calls `openBrigade`. It no longer peeks, and it no longer falls back to `hc attach`. A new `brigade open <address>` calls `openAgent`. `src/entrypoints/bootstrap.ts` builds every `HerdrApp` (Workspace, panel and mod check), so `cli.ts` builds no adapter (guide A2).
- [x] **T6 Panel.** A click on a Coordinator or Captain row (and rail cell) in `mod/main.js` runs `brigade open <address>`, the same way the Start button runs `brigade start`. Worker rows still peek. `installMod` writes the open command into `config.js`. The owner runs `brigade mod install` again.
- [x] **T7 Docs.** `README.md`, `CHANGELOG.md` (Unreleased, with the `hc kill` step for old Captains), `docs/herdr-app.md` and `docs/decisions.md` (Captains end with the Coordinator, and why).

## Out of scope

- The TUI and the second pane (3c).
- Removing the panel or the mod (3c).
- Other multiplexers. The port only makes them possible.
- Changes to the revive mod or the owner's herdr-app config.

## Acceptance checks

- `npm run gate` passes, with the output in the task proof.
- Mutation checks: break the `--outlive-parent` rule per role, the `keepOff` read-back and each `keepOff` call, each branch of the start flow, `first`, the wrong-space check and the refusal in `openAgent`. A named test fails each time.
- Live, on Claude (about 2 short model calls; the owner approves the model first). One check per branch of the flow:
  1. No Brigade space: `brigade start` makes it, with the Coordinator in tab 1 and no shell tab left.
  2. A running Coordinator in tab 1: `brigade start` only shows it.
  3. The Coordinator tab closed (this ends the Coordinator): `brigade start` resumes it in a new tab 1.
  4. The Coordinator ended with `hc kill`: herdr-app removes its tab, and `brigade start` resumes it in a new tab 1.
  5. A Captain started by a Coordinator request has no tab. A panel click opens its tab. `brigade start` gives a tab to a Captain that has none.
  6. Closing the space ends the Coordinator, the Captain and the worker.
  7. `hc get` shows core keep off on every brigade terminal after each of these steps.
- Not checked live: herdr-app or hc not running. The owner's window and core must not stop, so unit tests cover these.
- `docs/e2e-runs.md` records every live run, with what was checked by hand.

## Risks

- A worker reports to the Captain address it got at start. After the Captain restarts, that address is gone, and a running worker's reports are lost. This was already true before 3b; it goes on the backlog.

- The auto-mode classifier blocked hc and herdr-app commands on terminals and the window before. T0 and the live checks need the owner's approval, or the owner runs them.
- A space named "Brigade" made by the owner, in another folder, is not brigade's. Brigade makes its own space with the Coordinator folder.
- The owner can click or type in the window while `brigade start` runs, and change the shown space. T3's wrong-space check catches this. It does not repair it.

## Review

- Reviewed: waived by the owner 2026-11-11; plan hash 8b8d77b3f43b
- [fixed] Captains that already run keep `--outlive-parent` - a decision and a CHANGELOG step: stop them once with `hc kill` (T7).
- [rejected] `find` could take an ended Coordinator as running - `hc ls` lists only live terminals (`--all` adds ended ones), and 3a live check 1 resumed after `hc kill`.
- [fixed] An agent with a tab in another space - `open` shows that tab and moves nothing (Decisions, T2).
- [fixed] The flow makes a tab before the Coordinator runs, but a tab needs a running terminal - brigade starts the Coordinator first; the result is the same.
- [fixed] `terminal.keep` depends on the shown space - T3 reads `ls` again and fails without moving anything if the tab is in the wrong space.
- [fixed] Tabs of ended terminals pile up - T0 saw herdr-app remove them itself (Facts, check 4).
- [fixed] One pane is not enforced - brigade makes one pane and leaves an owner's split as it is (Decisions).
- [fixed] `tab.close` ends its terminals too - check 3 expects a resume; T0 confirmed it.
- [fixed] `cli.ts` builds `HerdrApp` itself - T5 moves every `HerdrApp` into bootstrap (guide A2).
- [fixed] Keeping a shell tab contradicts check 1 - T0 stops and replans if brigade cannot remove it; T0 removed it.
- [fixed] A failure after `terminal.keep` skips `keepOff` - `keepOff` runs also when `open` fails, with failure tests (T4).
- [fixed] Closing the shell tab first can remove the new space - it is closed only after the new tab is in the space (T3).
- [fixed] `first` moved a tab outside the Brigade space - it moves only a tab in the Brigade space (T2).
- [fixed] T1 skipped `launch.ts`, which builds every `TerminalLaunch` - `launchOnce` sets `outliveParent` from the role (T1).
- [fixed] One failure stops the `keepOff` sweep - the sweep tries every terminal, also after an earlier failure, and reports all failures (T4).
- [fixed] T0 claimed every untested fact - it names the restart and reboot exclusion, and ended-tab removal is herdr-app's own behavior (T0, Facts).
