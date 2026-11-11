# What shipped

The latest release is v1.2.0 (2026-11-10). `CHANGELOG.md` lists each release.

## Features

| Feature | What it does | Since |
| --- | --- | --- |
| Roles | A Coordinator, a Captain per project and a worker per task, each in its own Herdr terminal. | 1.0.0 |
| Harness per role | Each role runs on Claude Code, Codex or pi, with a model, effort and permission level (`ask`, `auto`, `bypass`). | 1.0.0 |
| Projects from chat | `find_repo` searches `repoRoots`. `add_project` pins the repo's GitHub `origin` and takes its default branch as the base. | 1.0.0 |
| Worktrees and commits | Each task gets a branch and git worktree. Workers commit through brigade, which checks the worktree first. | 1.0.0 |
| Pull requests | `create_pull_request` pushes only to the pinned repo, never with force, and never to a merged or closed PR's branch. | 1.0.0 |
| Project notes | Every new worker starts with its project's notes, within a budget. The Captain settles workers' suggested notes. | 1.0.0 |
| Brigade panel | A herdr-app panel shows agents, tasks, PR chips, note counts and events. It has a Start button, and a click on a row opens that agent. | 1.0.0 |
| `repo_status` | The Coordinator and Captains read a project's branch, changes, commits, worktrees and open PRs without a shell. | 1.1.0 |
| `herdr_agents` | The Coordinator lists every live terminal in Herdr. | 1.1.0 |
| Captain answers | A Captain answers every Coordinator request through `report`. | 1.1.0 |
| Owner's MCP servers | A Claude Coordinator also loads the owner's own MCP servers, such as a task app. Claude Captains and workers get brigade's server only. | 1.2.0 |
| Panel column and rail | The panel can sit in its own layout column, so it stays in every space. An icon or the `brigade.toggle` key folds it to a rail of clickable agent icons (`docs/herdr-app.md`). | Unreleased (`8082856`) |
| Resume | The Coordinator and each Captain continue their last conversation after a stop or a reboot, on Claude, Codex or pi. Each Captain runs in a folder of its own and reads its repo from there. `brigade start --new` starts the Coordinator in a new conversation. | Unreleased (`da84d99`) |

## Known defects

- A Codex agent in any role loads the MCP servers in the owner's `~/.codex/config.toml` and those of the owner's Codex plugins, such as computer use. So a Codex worker can reach the owner's own tools. `SECURITY.md` and `docs/decisions.md` record it.
- A pi agent in any role loads the MCP servers in the owner's `~/.pi/agent/mcp.json`, with no approval prompt. Same records.
