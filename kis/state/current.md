# Current state

Stamp: main a057c6e 5b668a43bea9

- Branch: `main`, in the repo root. No other worktrees.
- Task: none. v1.2.0 shipped on 2026-11-10, and KIS was set up on 2026-11-11.
- Blocker: none.
- Next: the owner decides whether to close the Codex MCP gap (`kis/intent/backlog.md`).

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- `npm run gate` passed on 2026-11-10 at `7bd4b3c`: 242 tests, suppressions 9 (baseline 9).
- GitHub CI passed on `7bd4b3c`.
- Live check on 2026-11-10: the Coordinator read the owner's task app through its MCP server.
