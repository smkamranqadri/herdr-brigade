# Agent instructions

## Non-negotiables

- Follow the engineering guide at `~/Repositories/agent-guide/GUIDE.md`. Cite its rules by ID in plans and reviews.
- Keep the layers: `domain` imports nothing else, `application` imports only `domain`, adapters never import each other, and only `src/entrypoints/bootstrap.ts` builds adapters (`docs/architecture.md`).
- Run agents through `hc` only. Never stop or restart the owner's `hc` core or herdr-app.
- A test that starts a real agent or a real `hc` terminal is slow: name the file `*.e2e.test.ts`. The default test run leaves it out.
- Never print a secret. Settings and tokens stay out of argv, logs and events.
- `poc/` is throwaway reference code. Don't extend it.

## Gate

```sh
mise install          # the pinned Node, once
npm ci                # also installs the pre-commit hook
npm run gate          # format, lint, types, layer rules, unused code, suppressions, tests with coverage
```

The pre-commit hook runs `npm run precommit` (format, lint, types). A task is done only when `npm run gate` passes and its output is in the task proof.

Real agents (not part of the gate; uses model usage): `npm run e2e -- <claude|codex|pi> "<request>"`. Runs go to `~/.local/state/herdr-brigade-e2e`, outside any repo. Record each run in `docs/e2e-runs.md`, with what you checked by hand.

## Playbooks

**Add a harness** (an agent program like `claude`):
1. Add its name to `HARNESSES` in `src/domain/agent.ts`.
2. Add `src/adapters/harness/<name>.ts`, which builds its launch argv.
3. Make it pass the shared harness contract tests.
4. Record its trust prompt and its startup status in `docs/spike-harnesses.md`.

**Add an MCP tool:**
1. Write the use case in `src/application/`, with a test against the fakes.
2. Register the tool for its role in `src/adapters/mcp/`. Keep the handler thin (guide A5).
3. Name the tool in the role's prompt in `prompts/`.

## Ask the owner before

A new dependency, a change to the layers, anything that writes to the owner's global config (`~/.claude`, `~/.codex`, `~/.pi`, `~/.config/herdr-app`), deleting files, and any push.

## Pointers

- `kis/state/current.md`: what is happening now. Phases 1 and 2 are done (`docs/plan-phase-1.md`, `docs/plan-phase-2.md`).
- `docs/architecture.md`: layers and where new code goes.
- `docs/decisions.md`: dependencies and decisions, with reasons.
- `REVIEW.md`: what a reviewer checks.

<!-- kis:anchor:start -->
## KIS Project Memory

This project uses KIS memory under `kis/`. Knowledge = stable facts. Intent = goals and plans. Reality = what shipped. State = what is happening now.

- Read `kis/state/` before planning or implementing, then only the Intent, Reality, and Knowledge the task needs.
- Put each fact in exactly one layer, and update an existing file instead of creating a new one.
- Prove work with real command or verification output before marking anything done.
- Synchronize the KIS layers that changed when work finishes.
- Full instructions: `.agents/skills/kis/SKILL.md`.
- Commands live in `.agents/skills/kis/commands/`: start, plan, act, sync, check, init.
  Claude `/kis:start`, Pi and OpenCode `/kis-start`, Codex `/prompts:kis-start`.
  Antigravity has no custom slash commands: name the step and follow its command file.
<!-- kis:anchor:end -->
