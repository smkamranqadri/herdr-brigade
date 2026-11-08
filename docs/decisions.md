# Decisions

## Toolchain (2026-11-08)

| Item | Version | Reason |
| --- | --- | --- |
| Node | 22.23.3, pinned in `mise.toml` and `engines`; `.npmrc` has `engine-strict` | It runs TypeScript directly (type stripping), so there is no build step. `scripts/check-node.ts` fails the gate on any other version. |
| npm | 10.9.9 (`packageManager`) | The npm that ships with the pinned Node. |

## Dev dependencies (2026-11-08)

There are no runtime dependencies. The MCP server is our own code (guide D1).

| Package | Version | Why | Alternatives |
| --- | --- | --- | --- |
| `typescript` | 6.0.3 | Strict type check | 7.0.2 is newer, but `typescript-eslint` 8.72 supports only `<6.1`. |
| `@types/node` | 22.20.5 | Types for Node 22 | — |
| `vitest`, `@vitest/coverage-v8` | 5.1.0 | Tests and the coverage floor (guide T9) | `node:test` has no coverage threshold. |
| `eslint`, `@eslint/js` | 10.14.0, 10.0.1 | Lint, complexity, file size (guide C3) | Biome has no max-lines rule. |
| `typescript-eslint` | 8.72.1 | Type-aware lint rules | — |
| `prettier` | 3.9.10 | Format | Biome |
| `dependency-cruiser` | 18.7.2 | Import rules between layers (guide A1) | `eslint-plugin-boundaries` |
| `knip` | 6.44.2 | Unused code and dependencies (guide C10) | — |
| `lefthook` | 2.2.2 | Pre-commit hook (guide S7) | `husky` |

All are a year or more old, with releases this year and a known team or company behind them (guide D2). `knip` and `lefthook` list one npm maintainer each; their projects have wider teams (webpro and Evil Martians).

## Accepted advisory: `minimatch` in the dev tools (2026-11-08)

`npm audit` reports 10 moderate findings, all from one advisory: `minimatch` from 7.0.0 up to 11.0.1 can be slowed down by a crafted glob pattern. eslint 10.14 and typescript-eslint 8.72 depend on `minimatch` 10.2.6.

- **Why we accept it:** these are dev tools. They only match glob patterns from our own config files, so no attacker controls the input.
- **Why no fix yet:** npm's suggested fix downgrades eslint. Forcing `minimatch` 11 with `overrides` would put a 12-day-old major version under eslint, which guide D2 advises against.
- **Check:** the gate runs `npm audit --omit=dev`, which covers the runtime profile (empty).
- **Revisit:** when eslint or typescript-eslint moves to `minimatch` 11, or by 2026-12-08, whichever comes first.

## Permissions per role (2026-11-08, owner's choice)

Each role's config takes `permissions`: `ask`, `auto` or `bypass`. Workers default to `auto`; the Coordinator and Captains default to `ask`. Coordinators and Captains also never get Bash, Edit or Write, whatever their level.

- **Why:** with `ask`, a Claude worker stopped at every `git commit` until the owner approved it in Herdr.
- **Risk accepted:** the owner's lore says not to pass `--permission-mode auto` to `herdr agent start` (the older TUI). With `hc` and Claude Code 2.1.319, auto mode started with no opt-in screen, and a worker committed with no prompt (`docs/e2e-runs.md`). Auto mode still refuses some actions on its own, such as production deploys, `ssh` and credential reads.
- Claude Code's mode for each level: workers `acceptEdits` / `auto` / `bypassPermissions`; Coordinators and Captains `manual` / `auto` / `bypassPermissions`. `manual` replaces `default`, which is no longer on Claude's documented list.

## Gaps against the guide, on purpose (guide P8)

- **CI (S7, Q3):** none yet; there is no remote. Add it when the repo gets one.
- **Secret scan in pre-commit (part 7, tier 1):** `gitleaks` is not installed. Adding it needs the owner's OK (a new tool).
