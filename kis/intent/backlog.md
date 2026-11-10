# Backlog

No phase is planned after phase 2. These items wait for the owner's decision.

- **Close the Codex and pi MCP gaps.** Start Codex and pi Captains and workers with brigade's MCP server only, as Claude ones are. The owner chose docs only on 2026-11-11, because every role runs on Claude Code. Do this before a role moves to Codex or pi. Approach found on 2026-11-11 (no model calls):
  - Codex 0.167: `-c mcp_servers.<name>.enabled=false` turns off one server. A new `mcp_servers` table does not replace the owner's, because Codex merges the two. Take the names from `codex mcp list --json`. If that command fails, refuse to start the agent. `-c features.{apps,plugins,computer_use,browser_use,in_app_browser}=false` removes plugin servers such as computer use. `--ignore-user-config` is not an option: only `codex exec` has it, and it would also drop the owner's Codex hooks.
  - pi 1.5.2: take the names from `pi mcp list --json`, then remove their tools with `--tools -mcp__<name>__*`. Not tested in a session yet. `--no-mcp` and `--no-extensions` are not options.
