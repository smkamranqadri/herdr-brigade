# Architecture

Ports and adapters (guide part 3). Dependencies point inward. `npm run deps` enforces the rules below.

| Layer | Holds | May import |
| --- | --- | --- |
| `src/domain/` | Roles, harnesses, tasks, events, config types. No I/O. | `domain` only |
| `src/application/` | Use cases, and the ports they need: `Terminals` (hc), `Workspace` (herdr-app's spaces and tabs), `EventLog`, `Worktrees`, `Clock`. | `domain`, `application` |
| `src/adapters/<name>/` | One folder per outside system: `hc`, `herdrApp`, `harness`, `eventlog`, `git`, `mcp`. Each port has a fake. | `domain`, `application`; never another adapter |
| `src/entrypoints/` | `cli.ts` (the `brigade` command) and `bootstrap.ts`, the only place that builds adapters. | Everything |

Outside `src/`:

- `prompts/`: one system prompt per role, as files (guide M2).
- `pi-extension/`: registers brigade's MCP server for one pi session.
- `mod/`: the herdr-app mod. It is plain JavaScript run by herdr-app, so it can't import `src/`. It reads the event log and `hc` labels.

## How a request flows

1. You type in the Coordinator's terminal.
2. The Coordinator calls `send_to_captain`. Brigade starts that project's Captain if it isn't running, or types the message into it. A Captain runs in a folder of its own and reads the repo from there.
3. The Captain calls `create_task`. Brigade makes a git worktree and starts a worker there, on the harness chosen for it.
4. The worker calls `finish` or `ask_user`. Brigade records the event and types a report into the Captain.
5. The Captain calls `report`. Brigade types it into the Coordinator.

Brigade finds its agents by their `hc` labels (`brigade=<instance>`, `role`, `project`, `task`; the instance is `main` unless `BRIGADE_INSTANCE` sets another, as `scripts/e2e.sh` does with `e2e`), using `hc ls --label`, because `hc ls --json` does not print labels.

Each agent runs its own copy of the MCP server (`brigade mcp`). The server reads its role, project and task from its environment, and knows its terminal from `HC_TERMINAL_ID`.

## Where new code goes

- A new rule about tasks or events: `domain`.
- A new tool an agent can call: a use case in `application`, plus a thin handler in `adapters/mcp`.
- A new agent program: `adapters/harness/<name>.ts` (see the playbook in `AGENTS.md`).
