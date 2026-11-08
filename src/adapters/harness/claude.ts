import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessLaunch, HarnessLaunchRequest, TrustPrompt } from "../../application/ports.ts";
import type { Permission, Role } from "../../domain/agent.ts";

/** Claude Code asks once per folder; "Yes, I trust this folder" is the second choice. */
const CLAUDE_TRUST: TrustPrompt = {
  text: "trust this folder",
  keys: ["down", "enter"],
  ready: ["? for shortcuts", "accept edits on", "manual mode on", "auto mode on", "bypass permissions on"],
};

/** Coordinators and Captains route work, so they can never edit or run anything, whatever their permissions. */
const READ_ONLY = ["--disallowedTools", "Bash,Edit,Write,NotebookEdit"];

/** Claude Code's --permission-mode for each permission level. A worker on "ask" still edits its own worktree freely. */
const MODES: Readonly<Record<Permission, { readonly routing: string; readonly worker: string }>> = {
  ask: { routing: "manual", worker: "acceptEdits" },
  auto: { routing: "auto", worker: "auto" },
  bypass: { routing: "bypassPermissions", worker: "bypassPermissions" },
};

function roleFlags(role: Role, permissions: Permission): string[] {
  if (role === "worker") return ["--permission-mode", MODES[permissions].worker];
  return [...READ_ONLY, "--permission-mode", MODES[permissions].routing];
}

/** Builds the `claude` command for one agent, and writes its MCP config and system prompt under `agentDir`. */
export async function prepareClaude(req: HarnessLaunchRequest, agentDir: string): Promise<HarnessLaunch> {
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const promptFile = path.join(agentDir, "system-prompt.md");
  const mcpFile = path.join(agentDir, "mcp.json");
  await writeFile(promptFile, req.systemPrompt, { mode: 0o600 });
  const server = { type: "stdio", command: req.mcp.command, args: req.mcp.args, env: req.mcp.env };
  await writeFile(mcpFile, JSON.stringify({ mcpServers: { brigade: server } }, null, 2), { mode: 0o600 });
  // --mcp-config and --allowedTools take several values, so single-value flags sit between them and the first message.
  const argv = [
    "claude",
    "--strict-mcp-config",
    "--mcp-config",
    mcpFile,
    "--allowedTools",
    "mcp__brigade",
    ...roleFlags(req.role, req.spec.permissions),
    "--append-system-prompt-file",
    promptFile,
    "--model",
    req.spec.model,
    "--effort",
    req.spec.effort,
  ];
  if (req.firstMessage !== null) argv.push(req.firstMessage);
  return { argv, trust: CLAUDE_TRUST };
}
