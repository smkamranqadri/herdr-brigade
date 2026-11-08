# Phase 1 plan

Status: draft, waiting for the owner's approval. Date: 2026-11-08.

## Goal

You talk to one Coordinator in herdr-app. It sends project work to a Captain for each project. Each Captain starts workers, one per task, each in its own git worktree. A herdr-app mod shows the whole brigade live.

Each role (Coordinator, Captain, worker) runs on Claude Code, Codex or pi. You choose this in a config file for each role, and a Captain can choose a different one for a single task.

Done means: one real request goes from the Coordinator to a Captain to two workers in parallel, on each of the three harnesses, and the mod shows it. Unit tests and the gate pass.

## In scope

1. **`brigade` command.**
   - `brigade start`: starts the Coordinator.
   - `brigade status`: lists the brigade's agents and tasks.
   - `brigade mod install`: copies the mod into herdr-app.
   - `brigade mcp`: the MCP server that each agent starts.
2. **Config file** at `~/.config/herdr-brigade/config.json`, checked when it loads:
   - for each role: `harness` (`claude`, `codex` or `pi`), `model` and `effort`;
   - projects: name, repo folder and base branch.
3. **Harness adapters**, one for each harness. Each adapter builds the launch command for its harness:

   | | Claude Code | Codex | pi |
   | --- | --- | --- | --- |
   | Brigade MCP server | `--mcp-config <file>` | `-c mcp_servers.brigade.*` | `-e` with a brigade extension that calls `pi.registerMcpServer` |
   | System prompt | `--append-system-prompt-file` | `-c developer_instructions=…` | `--append-system-prompt <file>` |
   | Model and effort | `--model`, `--effort` | `-m`, `-c model_reasoning_effort=` | `--model`, `--thinking` |
   | Tool approval | `--allowedTools mcp__brigade` | `default_tools_approval_mode="approve"`, plus `env_vars=["HC_TERMINAL_ID"]` | None: pi has no permission prompts |
   | Folder-trust prompt | Answer Down, Enter | Answer Enter ("Trust and continue") | Only when the folder has pi project files |
   | Startup idle before turn 1 | No | Yes | Yes |

   The spike checked all of this (`docs/spike-harnesses.md`).
   | Other | — | `--no-daemon` (the `hc` manual requires it) | — |

4. **Tools for each role** (MCP):
   - Coordinator: `list_projects`, `send_to_captain`, `list_tasks`.
   - Captain: `create_task` (with an optional harness, model and effort), `send_to_task`, `list_tasks`, `report` (to the Coordinator).
   - Worker: `finish`, `ask_user`, `message_captain`.
5. **One git worktree and branch for each task**, under `~/.herdr/worktrees/<repo>/<branch>`, the same place your `worktree` mod uses.
6. **Event log**: one JSONL file in `~/.local/state/herdr-brigade/`. Task state comes from the events. Live status comes from `hc`.
7. **The mod**: projects, then each Captain and its tasks, with live status. A click focuses an agent. It also shows the latest events.
8. **Prompts as files** (guide M2). They take Box Yard's ideas, rewritten in our own words.
9. **Shared Claude setup**, as you chose. Workers use your hooks, `CLAUDE.md`, memory and logins. A `isolation` key is reserved for a clean setup later.

## Out of scope (later phases)

PR tracking and a merge button, project notes and the notes retro, hooks, schedules (`herdr-automations` already does these), remote machines, context compaction, and the clean-setup option.

## Steps

1. **Spike: done 2026-11-08.** Codex and pi each ran one worker turn and passed. See `docs/spike-harnesses.md`. Still open: a second `hc send` into a running Codex or pi agent. Step 3 tests that first.
2. **Project setup** (guide part 2):
   - `package.json` with `packageManager`, a `mise.toml` that pins Node 22.23.3, and a lock file;
   - `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `.editorconfig`, `.env.example`, `LICENSE` (MIT, unless you say otherwise);
   - lefthook for pre-commit, and a gate script that the hook and later CI share.
3. **A tracer bullet** (guide W4): the Coordinator, one Captain and one worker on Claude, through every layer, with tests.
4. Add the Codex and pi adapters, behind contract tests that every adapter passes.
5. Add parallel tasks with worktrees.
6. Add the mod.
7. Run the end-to-end check, once for each harness.

## Structure (guide part 3)

```
src/domain/        roles, task, events, config types; no I/O
src/application/   use cases and ports: Terminals (hc), EventLog, Worktrees, Clock
src/adapters/      hc, harness/{claude,codex,pi}, eventlog, git, mcp (stdio JSON-RPC)
src/entrypoints/   cli.ts, bootstrap.ts (the only place that builds adapters)
prompts/           coordinator.md, captain.md, worker.md
pi-extension/      brigade.ts
mod/               the herdr-app mod (plain JS: mods can't import our code)
```

TypeScript with `strict`, run directly by Node 22.23, which strips the types, so there is no build step. `tsc --noEmit` checks the types.

## Dependencies (dev only; nothing at runtime)

| Package | Why |
| --- | --- |
| `typescript`, `@types/node` | Type check |
| `vitest` | Tests |
| `eslint`, `typescript-eslint` | Lint, complexity and file-size rules |
| `prettier` | Format |
| `dependency-cruiser` | Import rules between layers (A1) |
| `knip` | Unused code and dependencies |
| `lefthook` | Pre-commit hook |

The MCP server stays our own (about 100 lines, rule D1), as in the POC. All of these are mature tools with many maintainers (rule D2). Exact versions go in `docs/decisions.md`.

## Default models (you can change them in the config)

| Role | Harness | Model | Effort | Why |
| --- | --- | --- | --- | --- |
| Coordinator | Claude Code | `claude-opus-5-5` | medium | It plans and routes; mistakes here spread. |
| Captain | Claude Code | `claude-sonnet-5-5` | low | It routes and reports. |
| Worker | Claude Code | `claude-sonnet-5-5` | medium | It writes code. |

The end-to-end checks in step 7 use `claude-sonnet-5-5` at low effort for Claude, your Codex default model (`gpt-6.1-terra`) at low effort, and pi with `openai/gpt-6.1-sol` at low thinking (your signed-in pi provider is `openai`, not `openai-codex`). Each check is a tiny task.

## Risks

- Codex or pi may not report status to `hc` the way Claude Code does. Step 1 checks this first.
- Trust prompts differ for each harness, and a missed one leaves a worker stuck. Each adapter gets a test with real screen text.
- `hc send` to a busy agent queues the message. Some harnesses may handle a queued message differently.
- Workers share your Claude setup, so your Stop hook runs in every Claude worker.

## Review

One reviewer agent reads this plan and the diff after step 3, without my summary (guide W5). I'll propose its harness and model when we get there.
