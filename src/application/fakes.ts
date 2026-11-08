// In-memory fakes of every port, for tests (guide A4, T2).
import type { AgentContext } from "../domain/agent.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import type { BrigadeEvent } from "../domain/events.ts";
import type {
  Deps,
  HarnessLaunchRequest,
  LaunchContext,
  TerminalInfo,
  TerminalLaunch,
  TrustOutcome,
  TrustPrompt,
} from "./ports.ts";

const TEST_CONFIG: BrigadeConfig = {
  owner: "Sam",
  roles: {
    coordinator: { harness: "claude", model: "opus", effort: "medium", permissions: "ask" },
    captain: { harness: "claude", model: "sonnet", effort: "low", permissions: "ask" },
    worker: { harness: "codex", model: "gpt-x", effort: "medium", permissions: "auto" },
  },
  projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main" }],
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
  prepare(req: HarnessLaunchRequest) {
    this.requests.push(req);
    return Promise.resolve({ argv: [req.spec.harness, req.agentId], trust: this.trust });
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
  create(repo: string, baseBranch: string, branch: string): Promise<string> {
    this.created.push({ repo, baseBranch, branch });
    return Promise.resolve(`/worktrees/${branch}`);
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
}

export function fakeDeps(options: { trust?: TrustPrompt; config?: BrigadeConfig } = {}): Fakes {
  const terminals = new FakeTerminals();
  const harnesses = new FakeHarnesses(options.trust ?? null);
  const events = new FakeEventLog();
  const worktrees = new FakeWorktrees();
  const mcpContexts: LaunchContext[] = [];
  const eventsAtTrust: number[] = [];
  terminals.onAnswerTrust = () => eventsAtTrust.push(events.events.length);
  let ids = 0;
  const deps: Deps = {
    config: options.config ?? TEST_CONFIG,
    terminals,
    harnesses,
    events,
    worktrees,
    prompts: { render: (role, values) => Promise.resolve(`${role} prompt for ${values.OWNER ?? "?"}`) },
    clock: { now: () => new Date("2026-11-08T10:00:00.000Z") },
    ids: { taskId: () => `task-00000${++ids}` },
    mcpFor: (context) => {
      mcpContexts.push(context);
      return { command: "node", args: ["brigade", "mcp"], env: { ROLE: context.role } };
    },
    coordinatorFolder: "/state/coordinator",
  };
  return { deps, terminals, harnesses, events, worktrees, mcpContexts, eventsAtTrust };
}

export const ctx = (over: Partial<AgentContext> & Pick<AgentContext, "role">): AgentContext => ({
  terminal: "t0",
  project: null,
  task: null,
  title: null,
  parent: null,
  ...over,
});
