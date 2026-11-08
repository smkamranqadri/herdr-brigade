import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessLaunch, HarnessLaunchRequest, TrustPrompt } from "../../application/ports.ts";
import type { Role } from "../../domain/agent.ts";

/** Claude Code asks once per folder; "Yes, I trust this folder" is the second choice. */
const CLAUDE_TRUST: TrustPrompt = {
  text: "trust this folder",
  keys: ["down", "enter"],
  ready: ["? for shortcuts", "accept edits on", "manual mode on", "bypass permissions on"],
};

/** Coordinators and Captains route work; they never edit or run anything. Workers edit in their own worktree. */
const ROLE_FLAGS: Readonly<Record<Role, readonly string[]>> = {
  coordinator: ["--disallowedTools", "Bash,Edit,Write,NotebookEdit", "--permission-mode", "default"],
  captain: ["--disallowedTools", "Bash,Edit,Write,NotebookEdit", "--permission-mode", "default"],
  worker: ["--permission-mode", "acceptEdits"],
};

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
    ...ROLE_FLAGS[req.role],
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
