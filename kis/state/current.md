# Current state

Stamp: main 8082856 081d4987653c

- Branch: `main`, in the repo root. No other worktrees. Two commits are not pushed yet.
- Task: none. On 2026-11-11 the panel got its own layout column and a fold rail (`8082856`, unreleased).
- Blocker: none.
- Next: the owner decides on a release and on the backlog (`kis/intent/backlog.md`).

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- `npm run gate` passed on 2026-11-11 on the code of `8082856`: 246 tests, suppressions 9 (baseline 9).
- Each of the 4 panel-width helpers in `mod/model.js` was broken on purpose, and a test failed each time.
- Live checks on 2026-11-11: the column stayed in two spaces, the toggle switched width 4 times, the owner folded it with `super-alt-b`, and a screenshot showed the rail with the Coordinator and 8 project letters. Captain and task dots were not seen live, because none were running.
- GitHub CI last passed on `7bd4b3c`.
