# Contributing to herdr-brigade

Thanks for helping. Brigade starts real coding agents in real repos, so the bar for a change is: it is small, it is
tested, and its guards are proven.

## Getting set up

```sh
git clone https://github.com/smkamranqadri/herdr-brigade.git && cd herdr-brigade
mise install && npm ci        # the pinned Node 22.23.3, the dev tools and the pre-commit hook
```

To try brigade without touching your real setup, point it at throwaway folders:

```sh
export BRIGADE_CONFIG=/tmp/brigade-dev/config.json BRIGADE_STATE=/tmp/brigade-dev/state BRIGADE_WORKTREES=/tmp/brigade-dev/worktrees
npm run brigade -- init
```

## Tests

```sh
npm run gate                              # everything below, in order; must pass before a pull request
npx vitest run src/domain/notes.test.ts   # one file while you work
```

The gate runs: the Node version check, Prettier, ESLint (with complexity and size limits), TypeScript in strict mode,
the layer rules (dependency-cruiser), unused code (knip), the suppression count, `npm audit`, and the tests with at
least 80% coverage. Tests use temporary folders, fakes for `hc` and GitHub, and real git; they never start an agent or
call a model.

`npm run e2e -- <claude|codex|pi> "<request>"` runs a real brigade end to end in its own folders under
`~/.local/state/herdr-brigade-e2e`. It needs `hc` and the agent CLI, and **it uses model usage**, so it is not part of
the gate. `docs/e2e-runs.md` records the runs so far.

## What a good pull request looks like

- **One change, with its test.** A bug fix comes with a test that fails without it. Assertions are exact.
- **Guards are checked by breaking them.** If you add a check (a refusal, a limit, a scope rule), break it on purpose,
  confirm its test fails, then restore it. Say so in the pull request.
- **Keep the layers.** `src/domain` has no I/O; `src/application` talks to the world only through the ports in
  `application/ports.ts`; adapters implement them; `src/entrypoints` wires them. dependency-cruiser enforces this.
- **No new runtime dependencies** without a reason in the pull request. Brigade has none today.
- **Look at panel changes.** Include a screenshot of the panel (it is 368 px wide in herdr-app's side panel).
- **Prompts are code.** A change to `prompts/` that changes agent behavior needs a real run (`npm run e2e`), noted in
  the pull request.

## Where things live

```text
src/domain/          config, tasks, notes and pull requests, folded from the event log
src/application/     the tools each role calls (captain.ts, worker.ts, notes.ts, publish.ts, projects.ts)
src/adapters/        hc terminals, git worktrees, the gh CLI, harness launchers, the MCP server
src/entrypoints/     the brigade CLI and the composition root (bootstrap.ts)
prompts/             each role's system prompt
mod/                 the herdr-app panel (model.js is tested against the domain's folds)
docs/                architecture, decisions, plans, real-agent runs and reviews
```

`AGENTS.md` holds the rules coding agents follow in this repo; they apply to people too.

## Reporting bugs

Open an issue with your OS, the versions of Node, `hc`, `herdr-app` and the agent CLIs, what you expected, and the
relevant lines of `~/.local/state/herdr-brigade/events.jsonl`. Remove anything private first: repo names, prompts,
notes and paths you would rather not share. Report security problems privately (see [SECURITY.md](SECURITY.md)).
