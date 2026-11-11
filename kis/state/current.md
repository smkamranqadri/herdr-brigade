# Current state

Stamp: main 5395a6a 0280f85838c2

- Branch: `main`, in the repo root. No other worktrees. Four commits are not pushed yet.
- Task: phase 3b, the Brigade space (`kis/intent/plan-phase-3b.md`, reviewed twice). T0, the live probe, is done; no code yet. Phase 3a is done (`da84d99`, unreleased).
- Blocker: none. No test agents are running.
- Next: 3b T1, the hc changes (`outliveParent` and `keepOff`).

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- 3b T0 probe on 2026-11-11 (herdr-app 0.1.15, hc 0.1.20), results in `docs/herdr-app.md`: `terminal.keep` turns core keep on, and `hc keep <t> --off` turns it off. All 5 probe terminals were removed, and the probe space is gone.
- `npm run gate` passed on 2026-11-11 on the code of `da84d99`: 261 tests, coverage 97.98% of statements, suppressions 9 (baseline 9), 0 vulnerabilities.
- 18 mutations of the 3a rules (resume flags, read folders, Captain folder, `--new`, the fallback and its retry, `no_session` before and after a trust answer, `remove`) each failed a named test. Each file was restored byte for byte.
- Live checks passed on 2026-11-11 on Claude, Codex and pi (`docs/e2e-runs.md`). They found a bug, fixed in `da84d99`: after a trust answer, Claude can still end with no session.
- GitHub CI last passed on `7bd4b3c`.
