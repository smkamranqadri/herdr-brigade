import type { AgentSpec, Role } from "../domain/agent.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import type { BrigadeEvent, PrState } from "../domain/events.ts";

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
  /** Keep running when the parent's program ends. False: it ends with its parent. */
  readonly outliveParent: boolean;
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
  /** Text the program prints before it ends when asked to resume and it has no session to resume. */
  readonly noSession?: string;
}

/** no_session: the program found no session to resume (TrustPrompt.noSession) and ended. */
export type TrustOutcome = "answered" | "ready" | "timeout" | "no_session";

/** Port to herdr-core (hc). */
export interface Terminals {
  launch(req: TerminalLaunch): Promise<string>;
  /** Answers the trust prompt if it appears, or sees the agent ready without one, or sees it find no session, or gives up. */
  answerTrust(address: string, trust: TrustPrompt): Promise<TrustOutcome>;
  /** Ends the terminal if it still runs and removes it, so its name is free. */
  remove(address: string): Promise<void>;
  /**
   * Turns hc's core keep off and checks that it is off. With keep on, a reboot leaves a shell in place of the agent,
   * where the owner's tools can resume it without brigade's limits. Fails if keep stays on.
   */
  keepOff(address: string): Promise<void>;
  /** Types text into the terminal and presses Enter, waiting while a just-started agent settles. */
  send(address: string, text: string): Promise<void>;
  /** Live terminals that carry all of these labels. */
  find(labels: Readonly<Record<string, string>>): Promise<TerminalInfo[]>;
  /** Every live terminal on this machine, brigade's or not: the owner's own Herdr agents and shells too. */
  all(): Promise<HerdrTerminal[]>;
}

/**
 * Where the owner sees agents: a multiplexer's spaces and tabs. herdr-app is the first. Brigade starts agents through
 * Terminals; the Workspace only shows them.
 */
/** A space in the Workspace: found by its folder alone, and made with this name when no space has that folder. */
export interface SpacePlace {
  readonly name: string;
  readonly folder: string;
}

export interface OpenOptions {
  /** Where a terminal with no tab gets one. */
  readonly place: SpacePlace;
  /** Move the tab to position 1, but only when it is in `place`'s space. */
  readonly first: boolean;
  /**
   * Show the owner's earlier space and tab again at the end, also after a failure. Best effort: a tab or space that
   * has gone is skipped.
   */
  readonly returnToView: boolean;
}

export interface Workspace {
  /** Fails with a message for the owner when the window is not running. */
  check(): Promise<void>;
  /**
   * Shows the terminal's tab. A terminal with no tab gets one in the first space whose folder is `place.folder`; that
   * space is made when there is none. A tab in another space is shown and not moved.
   */
  open(address: string, options: OpenOptions): Promise<void>;
}

/** One live terminal as Herdr shows it. */
export interface HerdrTerminal {
  readonly address: string;
  /** The program Herdr recognised (claude-code, codex, bash...), or null. */
  readonly program: string | null;
  readonly status: string | null;
  /** Herdr's "space / tab" for it, or null for a terminal without a pane. */
  readonly where: string | null;
  readonly cwd: string | null;
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
  /** Folders outside its own that the agent reads, such as a Captain's repo. */
  readonly readDirs: readonly string[];
  /** Continue the newest session in the agent's folder instead of starting a new one. */
  readonly resume: boolean;
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
  /**
   * Whether git runs the repo's hooks. False for a sandboxed worker: brigade's git runs outside its sandbox, and a
   * hook manager runs commands from files the worker can edit.
   */
  readonly runHooks: boolean;
}

export interface Worktrees {
  /** Creates a new branch from `baseBranch` in its own worktree, and returns the worktree's path. */
  create(repo: string, baseBranch: string, branch: string): Promise<string>;
  /**
   * Commits every change in the task's worktree, after checking it is still that task's worktree of that repo, on
   * that branch. Returns null when there is nothing to commit.
   */
  commit(target: CommitTarget, message: string): Promise<Commit | null>;
  /**
   * Pushes the task branch, fast-forward only, after the same worktree checks as commit, and only when `origin`
   * is `github` (owner/name) on github.com.
   */
  push(target: CommitTarget, github: string): Promise<void>;
  /** Fails unless the task's worktree is still there, still of that repo, and on that branch: commit's checks. */
  verify(target: CommitTarget): Promise<void>;
}

export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: PrState;
  readonly head: string;
  readonly base: string;
  readonly headSha: string | null;
  readonly mergedAt: string | null;
}

/** Port to GitHub's pull requests. Every call names the repo (owner/name) explicitly. */
export interface GitHub {
  /** Every PR, in any state, whose head is `head` in `repo`. */
  pullRequestsFor(repo: string, head: string): Promise<PullRequest[]>;
  create(repo: string, pr: { head: string; base: string; title: string; body: string }): Promise<PullRequest>;
  edit(repo: string, num: number, pr: { title: string; body: string }): Promise<void>;
  view(repo: string, num: number): Promise<PullRequest>;
  /** The open PRs of `repo`, newest first, at most 20. */
  openPullRequests(repo: string): Promise<OpenPullRequest[]>;
}

export interface OpenPullRequest {
  readonly number: number;
  readonly title: string;
  readonly head: string;
  readonly isDraft: boolean;
}

/** What brigade needs to know about a folder before it becomes a project. */
export interface RepoFacts {
  /** The folder is the top of its git repo, not a folder inside one. */
  readonly isRoot: boolean;
  readonly currentBranch: string | null;
  /** The fetch URL of `origin`, or null without one. */
  readonly origin: string | null;
  /** The branch `origin`'s HEAD names (the repo's default branch on its host), or null when git doesn't know it. */
  readonly originHead: string | null;
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
  /** The repo's state, read without changing anything (no index refresh, no lock). */
  status(folder: string): Promise<RepoStatus>;
}

export interface RepoStatus {
  readonly branch: string | null;
  /** The upstream branch and how far HEAD is ahead of and behind it, or null without one. */
  readonly upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null;
  readonly changes: {
    readonly staged: number;
    readonly unstaged: number;
    readonly untracked: number;
    /** The first few changed paths. */
    readonly files: readonly string[];
  };
  /** The last few commits on HEAD, newest first. */
  readonly commits: readonly { readonly sha: string; readonly subject: string; readonly date: string }[];
  /** Local branches, most recently committed first. */
  readonly branches: readonly { readonly name: string; readonly date: string }[];
  readonly worktrees: readonly { readonly path: string; readonly branch: string | null }[];
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
  /** Resolves after `ms`. It never keeps the process alive by itself. */
  wait(ms: number): Promise<void>;
}

/** Named locks shared by every brigade process. */
export interface Locks {
  /** Runs `work` while holding the lock `name`. Waits for it for a while, then fails with a message. */
  withLock<T>(name: string, work: () => Promise<T>): Promise<T>;
}

/** Port to brigade's own folders on disk. */
export interface Folders {
  /** Makes the folder, readable by the owner only, if it is missing. */
  ensure(folder: string): Promise<void>;
}

export interface Ids {
  taskId(): string;
  noteId(): string;
  suggestionId(): string;
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
  readonly github: GitHub;
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
  readonly folders: Folders;
  /** Where the Coordinator runs. */
  readonly coordinatorFolder: string;
  /** Each Captain runs in its own folder here, named after its project. */
  readonly captainsFolder: string;
  /** Where the owner sees agents. */
  readonly workspace: Workspace;
  readonly locks: Locks;
}
