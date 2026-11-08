import type { AgentContext } from "../domain/agent.ts";
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
  await deps.worktrees.push({ worktree: task.worktree, repo: t.repo, branch: task.branch }, github);
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

/** Reads the live state of up to PR_REFRESH_MAX stale PRs, a few at a time, then returns every task's PR. */
export async function refreshPrs(deps: Deps, tasks: readonly string[]): Promise<Map<string, TaskPr>> {
  const now = deps.clock.now();
  const before = derivePrs(await deps.events.read());
  const stale = tasks.flatMap((t) => {
    const pr = before.get(t);
    return pr && prStale(pr, now, PR_FRESH_MS) ? [[t, pr] as const] : [];
  });
  const todo = stale.slice(0, PR_REFRESH_MAX);
  for (let i = 0; i < todo.length; i += PR_REFRESH_PARALLEL) {
    await Promise.all(todo.slice(i, i + PR_REFRESH_PARALLEL).map(([t, pr]) => refreshOne(deps, t, pr)));
  }
  return derivePrs(await deps.events.read());
}

/** The PR line for one task's report, refreshed if stale; empty when the task has no PR. */
export async function prReport(deps: Deps, task: string): Promise<string> {
  const pr = (await refreshPrs(deps, [task])).get(task);
  return pr ? prLine(pr, deps.clock.now()) : "";
}
