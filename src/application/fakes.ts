// In-memory fakes of every port, for tests (guide A4, T2).
import type { AgentContext } from "../domain/agent.ts";
import { checkedChange, type BrigadeConfig } from "../domain/config.ts";
import type { BrigadeEvent } from "../domain/events.ts";
import type {
  Commit,
  CommitTarget,
  Deps,
  FoundRepo,
  HerdrTerminal,
  OpenPullRequest,
  RepoStatus,
  PullRequest,
  Ids,
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
  /** The owner's own terminals, outside the brigade, that all() lists too. */
  readonly others: HerdrTerminal[] = [];
  all(): Promise<HerdrTerminal[]> {
    const brigade = this.live.map(({ address, status, labels }) => ({
      address,
      program: labels.harness ?? null,
      status,
      where: null,
      cwd: null,
    }));
    return Promise.resolve([...this.others, ...brigade]);
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
  readonly pushes: { target: CommitTarget; github: string }[] = [];
  push(target: CommitTarget, github: string): Promise<void> {
    this.pushes.push({ target, github });
    return Promise.resolve();
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
      this.config = checkedChange(this.config, change).config;
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    this.writes++;
    return Promise.resolve(this.config);
  }
}

/** Folders the fake knows: absent means "not a git repo". */
class FakeRepos {
  readonly folders = new Map<
    string,
    Omit<RepoFacts, "originHead"> & { originHead?: string | null; branches: string[] }
  >();
  readonly found: FoundRepo[] = [];
  readonly searches: { roots: readonly string[]; name: string }[] = [];
  find(roots: readonly string[], name: string): Promise<FoundRepo[]> {
    this.searches.push({ roots, name });
    return Promise.resolve(this.found);
  }
  inspect(folder: string): Promise<RepoFacts | null> {
    const f = this.folders.get(folder);
    if (!f) return Promise.resolve(null);
    return Promise.resolve({
      isRoot: f.isRoot,
      currentBranch: f.currentBranch,
      origin: f.origin,
      originHead: f.originHead ?? null,
    });
  }
  hasBranch(folder: string, branch: string): Promise<boolean> {
    return Promise.resolve(this.folders.get(folder)?.branches.includes(branch) ?? false);
  }
  readonly statuses = new Map<string, RepoStatus>();
  status(folder: string): Promise<RepoStatus> {
    const s = this.statuses.get(folder);
    return s ? Promise.resolve(s) : Promise.reject(new Error(`git status failed: ${folder} is not a git repo`));
  }
}

/** GitHub as a list of PRs, with every call recorded. */
class FakeGitHub {
  readonly prs: (PullRequest & { repo: string })[] = [];
  readonly calls: string[] = [];
  failViews = false;
  /** While set, views wait for it before they answer, as when GitHub is slow. */
  viewsWaitFor: Promise<void> | null = null;
  private next = 41;
  pullRequestsFor(repo: string, head: string): Promise<PullRequest[]> {
    this.calls.push(`list ${repo} ${head}`);
    return Promise.resolve(this.prs.filter((p) => p.repo === repo && p.head === head));
  }
  create(repo: string, pr: { head: string; base: string; title: string; body: string }): Promise<PullRequest> {
    this.calls.push(`create ${repo} ${pr.head}->${pr.base} "${pr.title}"`);
    const number = ++this.next;
    const made = {
      repo,
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      state: "open" as const,
      head: pr.head,
      base: pr.base,
      headSha: "abc",
      mergedAt: null,
    };
    this.prs.push(made);
    return Promise.resolve(made);
  }
  edit(repo: string, num: number, pr: { title: string }): Promise<void> {
    this.calls.push(`edit ${repo} #${num} "${pr.title}"`);
    return Promise.resolve();
  }
  view(repo: string, num: number): Promise<PullRequest> {
    this.calls.push(`view ${repo} #${num}`);
    const answer = () => {
      const pr = this.prs.find((p) => p.repo === repo && p.number === num);
      if (this.failViews || !pr) return Promise.reject(new Error("gh pr view failed: network"));
      return Promise.resolve(pr);
    };
    return this.viewsWaitFor ? this.viewsWaitFor.then(answer) : answer();
  }
  failLists = false;
  openPullRequests(repo: string): Promise<OpenPullRequest[]> {
    this.calls.push(`open ${repo}`);
    if (this.failLists) return Promise.reject(new Error("gh pr list failed: network"));
    const open = this.prs.filter((p) => p.repo === repo && p.state === "open");
    return Promise.resolve(
      open.map((p) => ({ number: p.number, title: `PR ${p.number}`, head: p.head, isDraft: false })),
    );
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
  readonly github: FakeGitHub;
}

/** Ids that count up across kinds: task-000001, note-000002, … */
function countingIds(): Ids {
  let n = 0;
  return { taskId: () => `task-00000${++n}`, noteId: () => `note-00000${++n}`, suggestionId: () => `sugg-00000${++n}` };
}

/** The fake ports with no state of their own. */
const FIXED = {
  prompts: {
    render: (role: string, values: Readonly<Record<string, string>>) =>
      Promise.resolve(`${role} prompt for ${values.OWNER ?? "?"}${values.NOTES ? `\n${values.NOTES}` : ""}`),
  },
  // A wait never ends unless a test says so: a deadline only passes when the test makes it.
  clock: { now: () => new Date("2026-11-08T10:00:00.000Z"), wait: () => new Promise<void>(() => undefined) },
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
  const config = options.config ?? TEST_CONFIG;
  const configStore = new FakeConfigStore(config);
  const repos = new FakeRepos();
  const github = new FakeGitHub();
  const deps: Deps = {
    config,
    configStore,
    repos,
    github,
    terminals,
    harnesses,
    events,
    worktrees,
    ...FIXED,
    ids: countingIds(),
    mcpFor: (context) => {
      mcpContexts.push(context);
      return { command: "node", args: ["brigade", "mcp"], env: { ROLE: context.role } };
    },
  };
  return { deps, terminals, harnesses, events, worktrees, mcpContexts, eventsAtTrust, configStore, repos, github };
}

export const ctx = (over: Partial<AgentContext> & Pick<AgentContext, "role">): AgentContext => ({
  terminal: "t0",
  project: null,
  task: null,
  title: null,
  parent: null,
  ...over,
});
