# Current state

Stamp: main e4684a7 61ba80e7a5e3

- Branch: `main`, in the repo root. No other worktrees. Pushed up to `e4684a7`.
- Task: none in progress. Project spaces and worker resume (`kis/intent/plan-tabs.md`) are done and synced to Reality.
- Blocker: none. No test agents are running.
- Next: the owner uses the brigade with the panel as a column of the owner's herdr-app layout (added on 2026-11-12, with a backup of the layout file). 3c, the TUI, is pinned.

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- plan-tabs live checks on 2026-11-12 (`docs/e2e-runs.md`, run `run-resume-claude-20261112-144501`, `claude-sonnet-5-5` low, about 6 model calls): all 8 checks passed after one fix (`ebc1a49`: a second open of the same task at once failed). The owner clicked task rows in the real panel: a running worker opened, and an ended one resumed. The rail was not checked (3c replaces it). The owner's 5 Captains were moved to their project spaces with `terminal.park` and `brigade start`, with no agent ended.
- plan-tabs T0 to T9 on 2026-11-12: `npm run gate` passed (323 tests, 98.14% of statements, suppressions 9, 0 vulnerabilities). Mutations of every guard each failed a named test (T1 to T4: 18, T5: 23, T6: 5, the concurrent-open fix: 1); each file was restored byte for byte. `mod/main.js` has no unit tests; `herdr-app check` passed on it.
- 3b and 3a proof is in `docs/e2e-runs.md` and the git history.
- GitHub CI passed on `e4684a7` on 2026-11-12 (run 43209396414).
