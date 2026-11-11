# Current state

Stamp: main d409f61 ba40e3e7b963

- Branch: `main`, in the repo root. No other worktrees. Eight commits are not pushed yet.
- Task: phase 3b, the Brigade space (`kis/intent/plan-phase-3b.md`, reviewed twice). T0 to T4 are done; T4 is not committed yet. Phase 3a is done (`da84d99`, unreleased).
- Blocker: none. No test agents are running.
- Next: 3b T5, the CLI: `brigade start` through `openBrigade`, a new `brigade open <address>`, and every `HerdrApp` built in bootstrap.

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- 3b T4 on 2026-11-11: `npm run gate` passed (288 tests, 97.99% of statements, suppressions 9, 0 vulnerabilities). 12 mutations of `openBrigade` and `openAgent` (keep off after each open and after a failed one, the sweep after a failure and past a failure, one line per failure, the hc and window checks, the refusal, which tab goes first and which is shown last) each failed a named test; each file was restored byte for byte.
- 3b T2 and T3 on 2026-11-11: `npm run gate` passed (277 tests, suppressions 9, 0 vulnerabilities). Coverage counts only `domain` and `application`, so it stayed at 97.74%. 8 mutations of `HerdrAppWorkspace` (space match by folder, move only in the Brigade space, the wrong-space check, `first`, the shell-tab close, the `check` error, the keep retry) each failed a named test; each file was restored byte for byte. Not run against the live window yet.
- 3b T1 on 2026-11-11: `npm run gate` passed (265 tests, 97.74% of statements, suppressions 9, 0 vulnerabilities, no lint warnings). 7 mutations (the outlive rule per role, the hc flag both ways, the `keepOff` call, its read-back and its error) each failed a named test; each file was restored byte for byte. `keepOff` was not run against a live terminal; its `hc get` fixture matches the T0 output.
- 3b T0 probe on 2026-11-11 (herdr-app 0.1.15, hc 0.1.20), results in `docs/herdr-app.md`: `terminal.keep` turns core keep on, and `hc keep <t> --off` turns it off. All 5 probe terminals were removed, and the probe space is gone.
- `npm run gate` passed on 2026-11-11 on the code of `da84d99`: 261 tests, coverage 97.98% of statements, suppressions 9 (baseline 9), 0 vulnerabilities.
- 18 mutations of the 3a rules (resume flags, read folders, Captain folder, `--new`, the fallback and its retry, `no_session` before and after a trust answer, `remove`) each failed a named test. Each file was restored byte for byte.
- Live checks passed on 2026-11-11 on Claude, Codex and pi (`docs/e2e-runs.md`). They found a bug, fixed in `da84d99`: after a trust answer, Claude can still end with no session.
- GitHub CI last passed on `7bd4b3c`.
