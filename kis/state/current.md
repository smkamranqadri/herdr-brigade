# Current state

Stamp: main 60aea11 338bd758b347

- Branch: `main`, in the repo root. No other worktrees.
- Task: none. v1.2.0 shipped on 2026-11-10. On 2026-11-11 the owner chose to document the Codex and pi MCP gaps, not fix them.
- Blocker: none.
- Next: none. The fix waits on the backlog until a role moves to Codex or pi.

How to run: `mise install`, `npm ci`, then `npm run gate`. Real agents: `npm run e2e -- <claude|codex|pi> "<request>"`.

## Proof

- `npm run gate` passed on 2026-11-11 with the doc change on top of `60aea11`: 242 tests, suppressions 9 (baseline 9).
- GitHub CI passed on `7bd4b3c`.
- Live check on 2026-11-10: the Coordinator read the owner's task app through its MCP server.
