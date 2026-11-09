import { sandboxed, type AgentContext } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import { derivePrs, prLine, prStale, type TaskPr } from "../domain/pullRequests.ts";
import { deriveTasks, type TaskView } from "../domain/tasks.ts";
import { record } from "./launch.ts";
import type { Deps, PullRequest } from "./ports.ts";

/** A PR state read within this long is reused, shared across all of brigade's processes through the event log. */
const PR_FRESH_MS = 30_000;
/** At most this many PR states are read in one list_tasks call, this many at a time. */
const PR_REFRESH_MAX = 8;
const PR_REFRESH_PARALLEL = 4;
/** list_tasks waits at most this long for GitHub, then reports the last known states. */
const PR_REFRESH_DEADLINE_MS = 15_000;
/**
 * When this process last asked GitHub about each PR, per event log. A PR whose checks keep failing keeps its old
 * checked time, so without this it would be first in line every time and crowd out the rest.
 */
const lastAsked = new WeakMap<object, Map<string, number>>();

/** One publish at a time per task in this process: two calls can't race to open two PRs. */
const publishing = new Map<string, Promise<unknown>>();

function serial<T>(task: string, work: () => Promise<T>): Promise<T> {
  const run = (publishing.get(task) ?? Promise.resolve()).then(work);
  publishing.set(
    task,
    run.catch(() => undefined),
  );
  return run;
}

async function workerTask(deps: Deps, ctx: AgentContext): Promise<TaskView> {
  if (ctx.role !== "worker" || !ctx.task || !ctx.project)
    throw new BrigadeError("Only a worker opens its task's pull request.");
  const task = deriveTasks(await deps.events.read()).find((t) => t.id === ctx.task);
  if (task?.project !== ctx.project) throw new BrigadeError(`Brigade has no record of ${ctx.task} in ${ctx.project}.`);
  return task;
}

async function recordState(deps: Deps, task: string, pr: PullRequest): Promise<void> {
  const { number, state, headSha, mergedAt } = pr;
  await record(deps, { kind: "pr_state", task, number, state, headSha, mergedAt });
}

interface PublishTarget {
  readonly task: TaskView;
  readonly github: string;
  readonly repo: string;
  readonly base: string;
}

/** Where this worker's task publishes: its project's pinned GitHub repo, and the repo and base it started from. */
async function publishTarget(deps: Deps, ctx: AgentContext): Promise<PublishTarget> {
  const task = await workerTask(deps, ctx);
  const project = deps.config.projects.find((p) => p.name === task.project);
  if (!project?.github) throw new BrigadeError(`Project ${task.project} has no GitHub repo, so it can't publish.`);
  return { task, github: project.github, repo: task.repo ?? project.repo, base: task.baseBranch ?? project.baseBranch };
}

/** Pushes, then opens a new PR or updates the open one for this head and base. */
async function pushAndOpen(
  deps: Deps,
  t: PublishTarget,
  existing: readonly PullRequest[],
  input: { title: string; body: string },
): Promise<string> {
  const { task, github, base } = t;
  const target = { worktree: task.worktree, repo: t.repo, branch: task.branch, runHooks: !sandboxed(task.spec) };
  await deps.worktrees.push(target, github);
  const open = existing.find((pr) => pr.base === base);
  if (open) await deps.github.edit(github, open.number, input);
  const pr = open
    ? await deps.github.view(github, open.number)
    : await deps.github.create(github, { head: task.branch, base, ...input });
  await record(deps, {
    kind: "pr_opened",
    task: task.id,
    repo: github,
    number: pr.number,
    url: pr.url,
    head: task.branch,
    base,
  });
  await recordState(deps, task.id, pr);
  return `${open ? "Updated" : "Opened"} PR #${pr.number}: ${pr.url}`;
}

/**
 * Pushes the worker's own task branch and opens its pull request, or updates the open one. Runs outside the agent's
 * sandbox. It first asks GitHub what exists for the branch, so a retry after a crash finds the PR it already opened,
 * and it never pushes to the branch of a merged or closed PR.
 */
export function createPullRequest(
  deps: Deps,
  ctx: AgentContext,
  input: { title: string; body: string },
): Promise<string> {
  return serial(ctx.task ?? "", async () => {
    const target = await publishTarget(deps, ctx);
    const existing = await deps.github.pullRequestsFor(target.github, target.task.branch);
    const done = existing.find((pr) => pr.state !== "open");
    if (done) {
      throw new BrigadeError(
        `PR #${done.number} for ${target.task.branch} is ${done.state}. Its branch is finished: the work needs a new task.`,
      );
    }
    return pushAndOpen(deps, target, existing, input);
  });
}

async function refreshOne(deps: Deps, task: string, pr: TaskPr): Promise<void> {
  try {
    await recordState(deps, task, await deps.github.view(pr.repo, pr.number));
  } catch {
    // GitHub didn't answer: the report shows the last known state and how old it is.
  }
}

/** Runs `work` on each item, `limit` at a time, starting no new item once `stop` says so. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  stop: () => boolean,
): Promise<void> {
  let next = 0;
  const runner = async () => {
    for (let item = items[next]; item !== undefined && !stop(); item = items[next]) {
      next++;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** The stale PRs to ask about now: the ones asked about least recently first, at most PR_REFRESH_MAX. */
function refreshQueue(deps: Deps, prs: Map<string, TaskPr>, tasks: readonly string[], now: Date) {
  const asked = lastAsked.get(deps.events) ?? new Map<string, number>();
  lastAsked.set(deps.events, asked);
  const key = (pr: TaskPr) => `${pr.repo}#${pr.number}`;
  const since = (pr: TaskPr) => Math.max(pr.checkedAt ? Date.parse(pr.checkedAt) : 0, asked.get(key(pr)) ?? 0);
  const stale = tasks.flatMap((t) => {
    const pr = prs.get(t);
    return pr && prStale(pr, now, PR_FRESH_MS) ? [[t, pr] as const] : [];
  });
  const todo = stale.sort(([, a], [, b]) => since(a) - since(b)).slice(0, PR_REFRESH_MAX);
  for (const [, pr] of todo) asked.set(key(pr), now.getTime());
  return todo;
}

/**
 * Reads the live state of up to PR_REFRESH_MAX stale PRs, a few at a time, for at most PR_REFRESH_DEADLINE_MS, then
 * returns every task's PR. A check still running at the deadline records its state when it ends.
 */
export async function refreshPrs(deps: Deps, tasks: readonly string[]): Promise<Map<string, TaskPr>> {
  const todo = refreshQueue(deps, derivePrs(await deps.events.read()), tasks, deps.clock.now());
  let late = false;
  const deadline = deps.clock.wait(PR_REFRESH_DEADLINE_MS).then(() => {
    late = true;
  });
  const checks = eachLimited(
    todo,
    PR_REFRESH_PARALLEL,
    ([t, pr]) => refreshOne(deps, t, pr),
    () => late,
  );
  await Promise.race([checks, deadline]);
  return derivePrs(await deps.events.read());
}

/** The PR line for one task's report, refreshed if stale; empty when the task has no PR. */
export async function prReport(deps: Deps, task: string): Promise<string> {
  const pr = (await refreshPrs(deps, [task])).get(task);
  return pr ? prLine(pr, deps.clock.now()) : "";
}
