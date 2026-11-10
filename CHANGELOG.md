# Changelog

## Unreleased

- The Brigade panel can sit in a column of its own, so it stays on screen in every space. An icon, or the `brigade.toggle` key command, folds it to a rail with the Coordinator, each project and its open tasks, as icons you can click (`docs/herdr-app.md`).

## 1.2.0 (2026-11-10)

- A Claude Coordinator also loads your own MCP servers from your Claude config (for example a notes or task app), so
  it can answer from them. Captains and workers still get brigade's server alone.

## 1.1.0 (2026-11-09)

- **`repo_status`** for the Coordinator and Captains: a project's branch, ahead/behind, uncommitted changes, recent
  commits, branches, worktrees and open pull requests, read by brigade itself without changing anything. The routing
  roles have no shell, so status questions no longer need a worker or a guess.
- **`herdr_agents`** for the Coordinator: every live terminal in Herdr, your own agents and shells too, with status,
  space/tab and folder.
- A Captain now answers every Coordinator request through `report`, also when it answers without a worker. Before,
  such an answer stayed in the Captain's terminal and never reached the Coordinator.
- `add_project` takes the repo's default branch (origin's HEAD, else `main`, else `master`) as the base branch, not
  whatever branch is checked out.

## 1.0.0 (2026-11-09)

First public release.

- **Roles:** a Coordinator for the brigade, a Captain per project and a worker per task, each in its own Herdr
  terminal. Any role runs on Claude Code, Codex or pi, with its own model, effort and permission level (`ask`, `auto`,
  `bypass`).
- **Projects from chat:** `find_repo` searches your repo folders, `add_project` pins the repo's GitHub origin, and
  `update_project` changes a base branch. Tasks keep the repo and base branch they started with.
- **Workers:** each task gets its own branch and git worktree. Workers commit through brigade, which checks the
  worktree first, so commits work inside Codex's sandbox too. Workers report when they finish or need a decision, and
  can message their Captain.
- **Pull requests:** `create_pull_request` pushes the task branch to the pinned GitHub repo and opens or updates its
  pull request. Merged or closed pull requests are never pushed to again, and `list_tasks` shows each one's live state.
- **Project notes:** lasting preferences that every new worker starts with, within a budget. Workers suggest notes
  and the Captain settles them in a retro.
- **The Brigade panel** for herdr-app: agents, tasks, PR chips, note counts and the latest events. A Start button,
  and a click on a row opens that agent over your tab.
- **Safety:** per-role tools with project scope checks, a locked config store, pushes only to the pinned repo with no
  force, tags or submodules, and no git hooks for sandboxed Codex workers. See `SECURITY.md`.
- Tested with hc 0.1.19, herdr-app 0.1.14, Claude Code 2.1.319, Codex 0.167.0 and pi 1.5.0.
