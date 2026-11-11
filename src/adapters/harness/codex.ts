import type { HarnessLaunch, HarnessLaunchRequest, TrustPrompt } from "../../application/ports.ts";
import type { Effort, Permission, Role } from "../../domain/agent.ts";

/** Codex asks once per folder; its first choice is "Trust and continue". */
const CODEX_TRUST: TrustPrompt = {
  text: "Trust this folder?",
  cursor: "›",
  yes: "Trust and continue",
  ready: ["? for shortcuts"],
};

/** Codex's reasoning efforts. It has no "max", so max runs as xhigh (not checked against Codex's own list). */
const EFFORT: Readonly<Record<Effort, string>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

/** A TOML basic string. JSON's escapes are valid TOML; TOML also wants DEL escaped. */
export function tomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", "\\u007F");
}

const tomlArray = (values: readonly string[]) => `[${values.map(tomlString).join(", ")}]`;
const tomlTable = (record: Readonly<Record<string, string>>) =>
  `{${Object.entries(record)
    .map(([k, v]) => `${k} = ${tomlString(v)}`)
    .join(", ")}}`;

/**
 * Approval and sandbox flags. Workers write in their worktree (and its git folder); with "bypass" Codex runs with
 * no sandbox. The Coordinator and Captains stay read-only whatever their level: they only route work.
 */
function permissionFlags(role: Role, permissions: Permission, writableDirs: readonly string[]): string[] {
  const approval = permissions === "ask" ? "on-request" : "never";
  if (role !== "worker") return ["-a", approval, "-s", "read-only"];
  if (permissions === "bypass") return ["--dangerously-bypass-approvals-and-sandbox"];
  return ["-a", approval, "-s", "workspace-write", ...writableDirs.flatMap((d) => ["--add-dir", d])];
}

/**
 * Builds the `codex` command for one agent. Its MCP server and instructions go in as `-c` settings. To resume, it runs
 * `codex resume --last`, which takes the newest session in this folder and starts a new one when there is none.
 * Codex needs no read folders: its read-only sandbox reads any folder.
 */
export function prepareCodex(req: HarnessLaunchRequest): Promise<HarnessLaunch> {
  const server = "mcp_servers.brigade";
  const argv = [
    "codex",
    ...(req.resume ? ["resume", "--last"] : []),
    // hc's manual: Codex must run with --no-daemon, or its commands run outside hc.
    "--no-daemon",
    "-m",
    req.spec.model,
    "-c",
    `model_reasoning_effort=${tomlString(EFFORT[req.spec.effort])}`,
    ...permissionFlags(req.role, req.spec.permissions, req.writableDirs),
    "-c",
    `${server}.command=${tomlString(req.mcp.command)}`,
    "-c",
    `${server}.args=${tomlArray(req.mcp.args)}`,
    "-c",
    `${server}.env=${tomlTable(req.mcp.env)}`,
    // Codex starts MCP servers with a bare env: pass the agent's own terminal address through.
    "-c",
    `${server}.env_vars=${tomlArray(["HC_TERMINAL_ID"])}`,
    "-c",
    `${server}.default_tools_approval_mode=${tomlString("approve")}`,
    "-c",
    `developer_instructions=${tomlString(req.systemPrompt)}`,
  ];
  // Codex 0.167 drops a message given on its command line once its trust prompt shows, so brigade types it in.
  return Promise.resolve({ argv, trust: CODEX_TRUST, sendFirst: req.firstMessage });
}
