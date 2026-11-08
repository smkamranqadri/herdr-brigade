// Reads brigade's environment once, at the edge (guide A8). Nothing deeper reads process.env.
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LaunchContext } from "../application/ports.ts";
import { isRole, type AgentContext } from "../domain/agent.ts";

const ENV = {
  role: "BRIGADE_ROLE",
  project: "BRIGADE_PROJECT",
  task: "BRIGADE_TASK",
  title: "BRIGADE_TITLE",
  parent: "BRIGADE_PARENT",
  config: "BRIGADE_CONFIG",
  state: "BRIGADE_STATE",
  hc: "BRIGADE_HC",
  worktrees: "BRIGADE_WORKTREES",
  terminal: "HC_TERMINAL_ID",
} as const;

export interface Paths {
  readonly configFile: string;
  readonly stateDir: string;
  readonly hc: string;
  readonly node: string;
  readonly cli: string;
  readonly promptsDir: string;
  readonly worktreesRoot: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Finds an executable on PATH, so agents get an absolute path (Codex starts MCP servers with a bare env). */
function onPath(name: string, env: Env): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const full = path.join(dir, name);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // Not in this folder; try the next one.
    }
  }
  return null;
}

export function readPaths(env: Env): Paths {
  const home = homedir();
  const hc = env[ENV.hc] ?? onPath("hc", env);
  if (!hc) throw new Error("hc (herdr-core) is not on PATH. Install Herdr, then try again.");
  return {
    configFile: env[ENV.config] ?? path.join(home, ".config", "herdr-brigade", "config.json"),
    stateDir: env[ENV.state] ?? path.join(home, ".local", "state", "herdr-brigade"),
    hc,
    node: process.execPath,
    cli: path.join(ROOT, "src", "entrypoints", "cli.ts"),
    promptsDir: path.join(ROOT, "prompts"),
    worktreesRoot: env[ENV.worktrees] ?? path.join(home, ".herdr", "worktrees"),
  };
}

/** The env a new agent's MCP server starts with: who the agent is, and where brigade keeps its files. */
export function mcpEnv(context: LaunchContext, paths: Paths): Record<string, string> {
  const env: Record<string, string> = {
    [ENV.role]: context.role,
    [ENV.config]: paths.configFile,
    [ENV.state]: paths.stateDir,
    [ENV.hc]: paths.hc,
    [ENV.worktrees]: paths.worktreesRoot,
  };
  if (context.project) env[ENV.project] = context.project;
  if (context.task) env[ENV.task] = context.task;
  if (context.title) env[ENV.title] = context.title;
  if (context.parent) env[ENV.parent] = context.parent;
  return env;
}

/** The calling agent, as its MCP server sees it. */
export function readAgentContext(env: Env): AgentContext {
  const role = env[ENV.role];
  const terminal = env[ENV.terminal];
  if (!isRole(role)) throw new Error(`${ENV.role} must be coordinator, captain or worker`);
  if (!terminal) throw new Error(`${ENV.terminal} is not set: brigade agents run inside hc terminals`);
  return {
    role,
    terminal,
    project: env[ENV.project] ?? null,
    task: env[ENV.task] ?? null,
    title: env[ENV.title] ?? null,
    parent: env[ENV.parent] ?? null,
  };
}
