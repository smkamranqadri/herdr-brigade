// In-memory fakes of every port, for tests (guide A4, T2).
import type { AgentContext } from "../domain/agent.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import type { BrigadeEvent } from "../domain/events.ts";
import type {
  Commit,
  CommitTarget,
  Deps,
  FoundRepo,
  RepoFacts,
  HarnessLaunchRequest,
  LaunchContext,
  TerminalInfo,
  TerminalLaunch,
  TrustOutcome,
  TrustPrompt,
} from "./ports.ts";

export const TEST_CONFIG: BrigadeConfig = {
  owner: "Sam",
  roles: {
    coordinator: { harness: "claude", model: "opus", effort: "medium", permissions: "ask" },
    captain: { harness: "claude", model: "sonnet", effort: "low", permissions: "ask" },
    worker: { harness: "codex", model: "gpt-x", effort: "medium", permissions: "auto" },
  },
  repoRoots: null,
  projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main", github: "acme/shop" }],
};

class FakeTerminals {
  readonly launched: TerminalLaunch[] = [];
  readonly sent: { address: string; text: string }[] = [];
  readonly trustAnswered: string[] = [];
  readonly live: (TerminalInfo & { labels: Readonly<Record<string, string>> })[] = [];
  private next = 1;

  launch(req: TerminalLaunch): Promise<string> {
    const address = `t${this.next++}`;
    this.launched.push(req);
    this.live.push({ address, name: req.name, labels: req.labels, status: "working" });
    return Promise.resolve(address);
  }
  /** What answerTrust reports, and a hook that runs when it is called. */
  trustOutcome: TrustOutcome = "answered";
  onAnswerTrust: () => void = () => undefined;

  answerTrust(address: string): Promise<TrustOutcome> {
    this.onAnswerTrust();
    this.trustAnswered.push(address);
    return Promise.resolve(this.trustOutcome);
  }
  send(address: string, text: string): Promise<void> {
    this.sent.push({ address, text });
    return Promise.resolve();
  }
  find(labels: Readonly<Record<string, string>>): Promise<TerminalInfo[]> {
    const hits = this.live.filter((t) => Object.entries(labels).every(([k, v]) => t.labels[k] === v));
    return Promise.resolve(hits.map(({ address, name, status }) => ({ address, name, status })));
  }
}

class FakeHarnesses {
  readonly requests: HarnessLaunchRequest[] = [];
  private readonly trust: TrustPrompt | null;
  constructor(trust: TrustPrompt | null = null) {
    this.trust = trust;
  }
  /** Act like Codex: hand the first message back to be typed in after start. */
  sendFirst = false;
  prepare(req: HarnessLaunchRequest) {
    this.requests.push(req);
    // Like every real harness, it delivers the first message exactly once: typed in after start, or in argv.
    const sendFirst = this.sendFirst ? req.firstMessage : null;
    const inArgv = !this.sendFirst && req.firstMessage !== null ? ["--", req.firstMessage] : [];
    return Promise.resolve({ argv: [req.spec.harness, req.agentId, ...inArgv], trust: this.trust, sendFirst });
  }
}

class FakeEventLog {
  readonly events: BrigadeEvent[] = [];
  append(event: BrigadeEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
  read(): Promise<BrigadeEvent[]> {
    return Promise.resolve([...this.events]);
  }
}

class FakeWorktrees {
  readonly created: { repo: string; baseBranch: string; branch: string }[] = [];
  readonly commits: { target: CommitTarget; message: string }[] = [];
  /** What the next commit returns; null means there was nothing to commit. */
  nextCommit: Commit | null = { sha: "abc123def456", files: 1 };
  create(repo: string, baseBranch: string, branch: string): Promise<string> {
    this.created.push({ repo, baseBranch, branch });
    return Promise.resolve(`/worktrees/${branch}`);
  }
  commit(target: CommitTarget, message: string): Promise<Commit | null> {
    this.commits.push({ target, message });
    return Promise.resolve(this.nextCommit);
  }
}

class FakeConfigStore {
  config: BrigadeConfig;
  writes = 0;
  constructor(config: BrigadeConfig) {
    this.config = config;
  }
  read(): Promise<BrigadeConfig> {
    return Promise.resolve(this.config);
  }
  update(change: (config: BrigadeConfig) => BrigadeConfig): Promise<BrigadeConfig> {
    try {
      this.config = change(this.config);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    this.writes++;
    return Promise.resolve(this.config);
  }
}

/** Folders the fake knows: absent means "not a git repo". */
class FakeRepos {
  readonly folders = new Map<string, RepoFacts & { branches: string[] }>();
  readonly found: FoundRepo[] = [];
  readonly searches: { roots: readonly string[]; name: string }[] = [];
  find(roots: readonly string[], name: string): Promise<FoundRepo[]> {
    this.searches.push({ roots, name });
    return Promise.resolve(this.found);
  }
  inspect(folder: string): Promise<RepoFacts | null> {
    const f = this.folders.get(folder);
    return Promise.resolve(f ? { isRoot: f.isRoot, currentBranch: f.currentBranch, origin: f.origin } : null);
  }
  hasBranch(folder: string, branch: string): Promise<boolean> {
    return Promise.resolve(this.folders.get(folder)?.branches.includes(branch) ?? false);
  }
}

export interface Fakes {
  readonly deps: Deps;
  readonly terminals: FakeTerminals;
  readonly harnesses: FakeHarnesses;
  readonly events: FakeEventLog;
  readonly worktrees: FakeWorktrees;
  readonly mcpContexts: LaunchContext[];
  /** How many events the log held each time a trust prompt was answered. */
  readonly eventsAtTrust: number[];
  readonly configStore: FakeConfigStore;
  readonly repos: FakeRepos;
}

/** The fake ports with no state of their own. */
const FIXED = {
  prompts: {
    render: (role: string, values: Readonly<Record<string, string>>) =>
      Promise.resolve(`${role} prompt for ${values.OWNER ?? "?"}`),
  },
  clock: { now: () => new Date("2026-11-08T10:00:00.000Z") },
  coordinatorFolder: "/state/coordinator",
  defaultRepoRoots: ["/home/sam/Repositories"],
};

export function fakeDeps(options: { trust?: TrustPrompt; config?: BrigadeConfig } = {}): Fakes {
  const terminals = new FakeTerminals();
  const harnesses = new FakeHarnesses(options.trust ?? null);
  const events = new FakeEventLog();
  const worktrees = new FakeWorktrees();
  const mcpContexts: LaunchContext[] = [];
  const eventsAtTrust: number[] = [];
  terminals.onAnswerTrust = () => eventsAtTrust.push(events.events.length);
  let ids = 0;
  const config = options.config ?? TEST_CONFIG;
  const configStore = new FakeConfigStore(config);
  const repos = new FakeRepos();
  const deps: Deps = {
    config,
    configStore,
    repos,
    terminals,
    harnesses,
    events,
    worktrees,
    ...FIXED,
    ids: { taskId: () => `task-00000${++ids}` },
    mcpFor: (context) => {
      mcpContexts.push(context);
      return { command: "node", args: ["brigade", "mcp"], env: { ROLE: context.role } };
    },
  };
  return { deps, terminals, harnesses, events, worktrees, mcpContexts, eventsAtTrust, configStore, repos };
}

export const ctx = (over: Partial<AgentContext> & Pick<AgentContext, "role">): AgentContext => ({
  terminal: "t0",
  project: null,
  task: null,
  title: null,
  parent: null,
  ...over,
});
