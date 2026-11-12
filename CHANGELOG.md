# Changelog

## Unreleased

- Role prompts, after a review of real brigade conversations: a worker answers every follow-up through a brigade tool, never as text in its terminal; a Captain ends its turn after `report` with no summary; the Coordinator names tasks that wait on you or stopped without a report at the start of each of your turns. Running agents pick this up when they restart.
- `BRIGADE_INSTANCE` gives a brigade its own label value (default `main`), so a test run never sees or messages your real brigade. `npm run e2e` runs as `e2e` and no longer refuses while your brigade runs. Run `brigade mod install` again so the panel keeps showing yours.
- The panel shows a Brigade logo instead of its fold button. The `brigade.toggle` key folds the column; the logo at the top of the rail unfolds it. Run `brigade mod install` again.
- The Brigade space holds the Coordinator in tab 1 and each Captain after it. Each worker gets its tab in its project's space: the first space whose folder is the repo, or a space brigade makes, named after the project. A new Captain gets its tab when it starts, and brigade then shows the tab you were on.
- A worker whose tab or space was closed can resume. A click on its task in the panel, or `brigade open <task id>`, resumes it in its worktree and opens its tab. A Captain's follow-up to it also resumes it. It keeps its task's model, limits and repo. Run `brigade mod install` again to get the new task clicks.
- The panel's rail opens Captains again: a click on a project's cell did nothing.
- `brigade start` opens a space named Brigade in herdr-app, with the Coordinator in tab 1 and a tab for each running Captain, instead of showing the Coordinator over your tab. In the panel, a click on the Coordinator or a Captain opens its tab (`brigade open <address>`). Run `brigade mod install` again to get the new clicks.
- A Captain now ends when the Coordinator ends. Closing the Brigade space or the Coordinator's tab also ends the workers, since herdr-app ends a terminal's sub-agents with it; a worker's worktree and commits stay. Captains that run now keep the old behavior until they restart: stop each one once with `hc kill <address>`.
- Brigade turns hc's core keep off on its terminals. herdr-app turns it on when it gives a terminal a tab, and after a reboot it would leave a shell where tools can restart an agent without brigade's limits.
- The Coordinator and the Captains keep their conversations. After a stop or a reboot, each start continues the agent's last conversation, on Claude Code, Codex or pi. `brigade start --new` starts the Coordinator in a new one. Each Captain now runs in a folder of its own and reads its repo from there, so its first start after this update is a new conversation.
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
