import type { HarnessLaunch, HarnessLaunchRequest } from "../../application/ports.ts";
import type { Effort, Role } from "../../domain/agent.ts";
import { writeAgentFile, type HarnessFiles } from "./files.ts";

/** pi's thinking levels cover all of brigade's efforts. */
const THINKING: Readonly<Record<Effort, string>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** The Coordinator and Captains only route work, so they lose pi's tools that change or run anything. */
const ROUTING_ONLY: Readonly<Record<Role, readonly string[]>> = {
  coordinator: ["--exclude-tools", "bash,edit,write"],
  captain: ["--exclude-tools", "bash,edit,write"],
  worker: [],
};

/**
 * Builds the `pi` command for one agent. pi has no per-run MCP flag, so brigade's own extension registers the server
 * for this session from a file named by `--brigade-mcp`. pi has no permission prompts, so every level runs alike.
 * `--no-approve` ignores a repo's own pi extensions and settings: a cloned repo can't run code through them.
 */
export async function preparePi(req: HarnessLaunchRequest, files: HarnessFiles): Promise<HarnessLaunch> {
  const promptFile = await writeAgentFile(files.agentDir, "system-prompt.md", req.systemPrompt);
  const mcpFile = await writeAgentFile(files.agentDir, "mcp.json", JSON.stringify(req.mcp, null, 2));
  const argv = [
    "pi",
    "--model",
    req.spec.model,
    "--thinking",
    THINKING[req.spec.effort],
    "--append-system-prompt",
    promptFile,
    "--no-approve",
    "-e",
    files.piExtension,
    "--brigade-mcp",
    mcpFile,
    ...ROUTING_ONLY[req.role],
  ];
  if (req.firstMessage !== null) argv.push("--", req.firstMessage);
  return { argv, trust: null, sendFirst: null };
}
