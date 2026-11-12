# Backlog

These items wait for the owner's decision. The first one is next.

- **Tabs for Captains and workers.** The owner's choices on 2026-11-11, after 3b:
  - A Captain gets a tab in the Brigade space when it starts. Brigade then shows the tab the owner was on.
  - A click on a worker row in the panel gives the worker a tab. The tab goes in the space whose folder is the project's repo, else in the Brigade space.
  - If the owner does not like click tabs, workers get a tab when they start, and brigade shows the owner's tab again.
  - A task row click still peeks today (3b T6).

- **Close the Codex and pi MCP gaps.** Start Codex and pi Captains and workers with brigade's MCP server only, as Claude ones are. The owner chose docs only on 2026-11-11, because every role runs on Claude Code. Do this before a role moves to Codex or pi. Approach found on 2026-11-11 (no model calls):
  - Codex 0.167: `-c mcp_servers.<name>.enabled=false` turns off one server. A new `mcp_servers` table does not replace the owner's, because Codex merges the two. Take the names from `codex mcp list --json`. If that command fails, refuse to start the agent. `-c features.{apps,plugins,computer_use,browser_use,in_app_browser}=false` removes plugin servers such as computer use. `--ignore-user-config` is not an option: only `codex exec` has it, and it would also drop the owner's Codex hooks.
  - pi 1.5.2: take the names from `pi mcp list --json`, then remove their tools with `--tools -mcp__<name>__*`. Not tested in a session yet. `--no-mcp` and `--no-extensions` are not options.
- **Tell rail letters apart.** The folded panel shows one letter per project, so two projects that start with the same letter look alike. Hovering names each one. Options: two letters, or a color per project as the left sidebar colors spaces. The owner has not decided.
- **Workers report to a Captain that has restarted.** A worker sends its reports to the Captain address it got at start (`context.parent`). After that Captain ends and a new one starts, the address is gone, and the reports are lost. It can happen when a Captain is stopped with `hc kill` while its workers run. Closing the Brigade space ends the workers too, so it does not happen there. A fix: look up the project's running Captain by its labels at report time. Found on 2026-11-11 in phase 3b.
