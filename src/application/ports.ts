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
  /** The character that marks the selected choice, e.g. "❯". */
  readonly cursor: string;
  /** Text of the choice that means yes, e.g. "Yes, I trust this folder". */
  readonly yes: string;
  /** Text that shows the agent is ready, so there is no prompt to answer. */
  readonly ready: readonly string[];
}

export type TrustOutcome = "answered" | "ready" | "timeout";

/** Port to herdr-core (hc). */
export interface Terminals {
  launch(req: TerminalLaunch): Promise<string>;
  /** Answers the trust prompt if it appears, or sees the agent ready without one, or gives up. */
  answerTrust(address: string, trust: TrustPrompt): Promise<TrustOutcome>;
  /** Types text into the terminal and presses Enter, waiting while a just-started agent settles. */
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
  /** Folders outside its own that a sandboxed agent must be able to write, such as the repo's git folder. */
  readonly writableDirs: readonly string[];
}

export interface HarnessLaunch {
  readonly argv: readonly string[];
  readonly trust: TrustPrompt | null;
  /**
   * A first message to type in once the agent is ready, for a harness that loses one given on its command line
   * (Codex drops it when its trust prompt shows). Null when the argv carries it, or when there is none.
   */
  readonly sendFirst: string | null;
}

/** Port to the agent programs: builds the command that starts one. */
export interface Harnesses {
  prepare(req: HarnessLaunchRequest): Promise<HarnessLaunch>;
}

export interface EventLog {
  append(event: BrigadeEvent): Promise<void>;
  read(): Promise<BrigadeEvent[]>;
}

export interface Commit {
  /** The new commit's short hash. */
  readonly sha: string;
  readonly files: number;
}

/** Where a task's commit must land, from brigade's own records, never from the agent. */
export interface CommitTarget {
  readonly worktree: string;
  readonly repo: string;
  readonly branch: string;
}

export interface Worktrees {
  /** Creates a new branch from `baseBranch` in its own worktree, and returns the worktree's path. */
  create(repo: string, baseBranch: string, branch: string): Promise<string>;
  /**
   * Commits every change in the task's worktree, after checking it is still that task's worktree of that repo, on
   * that branch. Returns null when there is nothing to commit.
   */
  commit(target: CommitTarget, message: string): Promise<Commit | null>;
}

/** What brigade needs to know about a folder before it becomes a project. */
export interface RepoFacts {
  /** The folder is the top of its git repo, not a folder inside one. */
  readonly isRoot: boolean;
  readonly currentBranch: string | null;
  /** The fetch URL of `origin`, or null without one. */
  readonly origin: string | null;
}

export interface FoundRepo {
  readonly name: string;
  readonly path: string;
}

/** Port to the owner's local git repos (read-only). */
export interface Repos {
  /** Git repos under `roots` whose folder name matches `name`, within fixed limits. */
  find(roots: readonly string[], name: string): Promise<FoundRepo[]>;
  /** Facts about a folder, or null when it is not a git repo. */
  inspect(folder: string): Promise<RepoFacts | null>;
  hasBranch(folder: string, branch: string): Promise<boolean>;
}

/** Port to brigade's config file. Every write is serialized across processes and lands whole. */
export interface ConfigStore {
  read(): Promise<BrigadeConfig>;
  /** Applies `change` to the config as it is now, checks the result, and writes it. Returns the new config. */
  update(change: (config: BrigadeConfig) => BrigadeConfig): Promise<BrigadeConfig>;
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
  /** The config as it was when this tool call started: one snapshot per call. */
  readonly config: BrigadeConfig;
  readonly configStore: ConfigStore;
  readonly repos: Repos;
  /** Where find_repo looks when the config names no repoRoots. */
  readonly defaultRepoRoots: readonly string[];
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
