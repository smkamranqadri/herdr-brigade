# Current state

Stamp: main 4414807 67f55d5c6ed3

- Branch: `main`, in the repo root. No other worktrees. Some commits are not pushed yet: `git log --oneline origin/main..main` lists them.
- Task: `kis/intent/plan-tabs.md` (Phase mode; reviewed by Codex on 2026-11-12). T0 is done. Now T1 to T4: project spaces and Captain tabs.
- Blocker: none. No test agents are running.
- Next: T1 to T4, then T5 to T9. Live checks need the owner's approval of the model first.

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- plan-tabs T0 on 2026-11-12 (herdr-app 0.1.15, hc 0.1.20), results in `docs/herdr-app.md`: `space.select` and `tab.select` showed the owner's earlier view again, and `tab.select` alone also switches the space. A tab was made in a space that was not shown. Missing ids exit 1 and leave the view. The probe space and both its terminals are gone. Checked by `ls` marks only, not by the owner's eye.
- `installMod` order on 2026-11-12: `npm run gate` passed (288 tests, 97.99% of statements, suppressions 9, 0 vulnerabilities). 2 mutations (`main.js` first again, `config.js` written after the copies) each failed the new test; the file was restored byte for byte. Live in the owner's window: after `brigade mod install`, `config.js` was written first and `main.js` last, and a click on a new kis-skill Captain (started by a Coordinator request, no tab) opened its tab.
- 3b live checks on 2026-11-11 (`docs/e2e-runs.md`, run `run-resume-claude-20261111-221605`, `claude-sonnet-5-5` low, 2 model calls): checks 1 to 5 and 7 passed. Check 6 found that closing the space ends workers too; the owner accepted that. No test terminal is left running.
- 3b T7 on 2026-11-11: README, CHANGELOG, `docs/decisions.md`, `docs/architecture.md` and `docs/herdr-app.md` updated; no stale peek claims left (grep). `npm run gate` passed (287 tests).
- 3b T6 on 2026-11-11: `npm run gate` passed (287 tests). `herdr-app check` passed on scratch copies of the mod with a new `config.js` and with one from before `OPEN`; a named import of `OPEN` failed that check, so the namespace import is needed. A mutation of the `OPEN` line failed the `installMod` test. The panel has not been seen in the live window yet.
- 3b T5 on 2026-11-11: `npm run gate` passed (287 tests, 97.99% of statements, suppressions 9, 0 vulnerabilities). The CLI ran by hand: the usage text, `open` with no address, `open t999` (refused), and `start`, `open` and `panel` with herdr-app off PATH (a clear message; `start` started no terminal). 2 mutations of the keep retry each failed a named test. `brigade start` has not run against the live window yet.
- 3b T4 on 2026-11-11: `npm run gate` passed (288 tests, 97.99% of statements, suppressions 9, 0 vulnerabilities). 12 mutations of `openBrigade` and `openAgent` (keep off after each open and after a failed one, the sweep after a failure and past a failure, one line per failure, the hc and window checks, the refusal, which tab goes first and which is shown last) each failed a named test; each file was restored byte for byte.
- 3b T2 and T3 on 2026-11-11: `npm run gate` passed (277 tests, suppressions 9, 0 vulnerabilities). Coverage counts only `domain` and `application`, so it stayed at 97.74%. 8 mutations of `HerdrAppWorkspace` (space match by folder, move only in the Brigade space, the wrong-space check, `first`, the shell-tab close, the `check` error, the keep retry) each failed a named test; each file was restored byte for byte. Not run against the live window yet.
- 3b T1 on 2026-11-11: `npm run gate` passed (265 tests, 97.74% of statements, suppressions 9, 0 vulnerabilities, no lint warnings). 7 mutations (the outlive rule per role, the hc flag both ways, the `keepOff` call, its read-back and its error) each failed a named test; each file was restored byte for byte. `keepOff` was not run against a live terminal; its `hc get` fixture matches the T0 output.
- 3b T0 probe on 2026-11-11 (herdr-app 0.1.15, hc 0.1.20), results in `docs/herdr-app.md`: `terminal.keep` turns core keep on, and `hc keep <t> --off` turns it off. All 5 probe terminals were removed, and the probe space is gone.
- `npm run gate` passed on 2026-11-11 on the code of `da84d99`: 261 tests, coverage 97.98% of statements, suppressions 9 (baseline 9), 0 vulnerabilities.
- 18 mutations of the 3a rules (resume flags, read folders, Captain folder, `--new`, the fallback and its retry, `no_session` before and after a trust answer, `remove`) each failed a named test. Each file was restored byte for byte.
- Live checks passed on 2026-11-11 on Claude, Codex and pi (`docs/e2e-runs.md`). They found a bug, fixed in `da84d99`: after a trust answer, Claude can still end with no session.
- GitHub CI last passed on `7bd4b3c`.
