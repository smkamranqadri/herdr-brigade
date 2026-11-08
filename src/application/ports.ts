import type { AgentSpec, Role } from "../domain/agent.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import type { BrigadeEvent } from "../domain/events.ts";

/** A live hc terminal, as brigade sees it. */
export interface TerminalInfo {
  readonly address: string;
  readonly name: string;
  /** The agent's reported status (idle, working, done, blocked, error), or null for plain programs. */
  readonly status: string | null;
}

export interface TerminalLaunch {
  /** Unique among live terminals: 1-32 of a-z, 0-9, - and _. */
  readonly name: string;
  readonly cwd: string;
  readonly labels: Readonly<Record<string, string>>;
  /** The parent's terminal; null runs it with no parent and no notes typed into one. */
  readonly parent: string | null;
  readonly argv: readonly string[];
}

/** A harness's first-run question about trusting a folder, and how to answer yes. */
export interface TrustPrompt {
  /** Text that shows the prompt is on screen. */
  readonly text: string;
  /** Keys that answer yes, e.g. ["down", "enter"]. */
  readonly keys: readonly string[];
  /** Text that shows the agent is ready, so there is no prompt to answer. */
  readonly ready: readonly string[];
}

/** Port to herdr-core (hc). */
export interface Terminals {
  launch(req: TerminalLaunch): Promise<string>;
  /** Answers the trust prompt if it appears. Returns whether it did. */
  answerTrust(address: string, trust: TrustPrompt): Promise<boolean>;
  send(address: string, text: string): Promise<void>;
  /** Live terminals that carry all of these labels. */
  find(labels: Readonly<Record<string, string>>): Promise<TerminalInfo[]>;
}

/** How an agent starts brigade's MCP server. */
interface McpCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface HarnessLaunchRequest {
  readonly role: Role;
  readonly spec: AgentSpec;
  /** A unique id for this agent's files, e.g. its terminal name. */
  readonly agentId: string;
  readonly systemPrompt: string;
  /** The first message; null starts the agent waiting for input. */
  readonly firstMessage: string | null;
  readonly mcp: McpCommand;
}

export interface HarnessLaunch {
  readonly argv: readonly string[];
  readonly trust: TrustPrompt | null;
}

/** Port to the agent programs: builds the command that starts one. */
export interface Harnesses {
  prepare(req: HarnessLaunchRequest): Promise<HarnessLaunch>;
}

export interface EventLog {
  append(event: BrigadeEvent): Promise<void>;
  read(): Promise<BrigadeEvent[]>;
}

export interface Worktrees {
  /** Creates a new branch from `baseBranch` in its own worktree, and returns the worktree's path. */
  create(repo: string, baseBranch: string, branch: string): Promise<string>;
}

export interface Prompts {
  render(role: Role, values: Readonly<Record<string, string>>): Promise<string>;
}

export interface Clock {
  now(): Date;
}

export interface Ids {
  taskId(): string;
}

/** What the launcher tells a new agent's MCP server about the agent. Its own terminal comes from hc. */
export interface LaunchContext {
  readonly role: Role;
  readonly project: string | null;
  readonly task: string | null;
  readonly title: string | null;
  readonly parent: string | null;
}

export interface Deps {
  readonly config: BrigadeConfig;
  readonly terminals: Terminals;
  readonly harnesses: Harnesses;
  readonly events: EventLog;
  readonly worktrees: Worktrees;
  readonly prompts: Prompts;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly mcpFor: (context: LaunchContext) => McpCommand;
  /** Where the Coordinator runs. */
  readonly coordinatorFolder: string;
}
