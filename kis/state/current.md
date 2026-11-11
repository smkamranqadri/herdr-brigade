# Current state

Stamp: main da84d99 763fb97d2d30

- Branch: `main`, in the repo root. No other worktrees. Four commits are not pushed yet.
- Task: none. Phase 3a, resume, is done (`da84d99`, unreleased). Plan: `kis/intent/plan-phase-3.md`.
- Blocker: none. No test agents are running.
- Next: plan phase 3b, the Brigade space, with its own KIS plan and review. Look at the `revive.session` labels on hc terminals first: the owner's revive mod already records each Claude session id.

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- `npm run gate` passed on 2026-11-11 on the code of `da84d99`: 261 tests, coverage 97.98% of statements, suppressions 9 (baseline 9), 0 vulnerabilities.
- 18 mutations of the 3a rules (resume flags, read folders, Captain folder, `--new`, the fallback and its retry, `no_session` before and after a trust answer, `remove`) each failed a named test. Each file was restored byte for byte.
- Live checks passed on 2026-11-11 on Claude, Codex and pi (`docs/e2e-runs.md`). They found a bug, fixed in `da84d99`: after a trust answer, Claude can still end with no session.
- GitHub CI last passed on `7bd4b3c`.
