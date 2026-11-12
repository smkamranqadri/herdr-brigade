import type { AgentSpec } from "./agent.ts";
import type { BrigadeEvent } from "./events.ts";

/** Where a task stands, from its events. Live terminal status comes from hc, not from here. */
type TaskState = "working" | "finished" | "asking";

export interface TaskView {
  readonly id: string;
  readonly project: string;
  readonly title: string;
  readonly branch: string;
  readonly worktree: string;
  readonly terminal: string;
  readonly spec: AgentSpec;
  /** The repo and base branch the task started from; null for tasks from before phase 2. */
  readonly repo: string | null;
  readonly baseBranch: string | null;
  readonly state: TaskState;
  /** The last summary or question, if any. */
  readonly note: string | null;
  readonly updatedAt: string;
}

/** The task an event is about, if any. */
function taskOf(e: BrigadeEvent): string | null {
  return "task" in e ? e.task : null;
}

/** One event applied to a task. A follow-up to the worker means it is working again. */
function applyEvent(current: TaskView, e: BrigadeEvent): TaskView {
  switch (e.kind) {
    case "task_finished":
      return { ...current, state: "finished", note: e.summary, updatedAt: e.at };
    case "task_asked":
      return { ...current, state: "asking", note: e.question, updatedAt: e.at };
    case "worker_resumed":
      return { ...current, terminal: e.terminal, updatedAt: e.at };
    case "message_sent":
      return e.to === "worker" ? { ...current, state: "working", updatedAt: e.at } : current;
    default:
      return current;
  }
}

/** Folds the event log into one view per task, in the order the tasks were created. */
export function deriveTasks(events: readonly BrigadeEvent[]): TaskView[] {
  const tasks = new Map<string, TaskView>();
  for (const e of events) {
    if (e.kind === "task_created") {
      const { project, task, title, branch, worktree, terminal, spec, at } = e;
      const pinned = { repo: e.repo ?? null, baseBranch: e.baseBranch ?? null };
      const view: TaskView = {
        id: task,
        project,
        title,
        branch,
        worktree,
        terminal,
        spec,
        ...pinned,
        state: "working",
        note: null,
        updatedAt: at,
      };
      tasks.set(task, view);
      continue;
    }
    const id = taskOf(e);
    const current = id === null ? undefined : tasks.get(id);
    if (id !== null && current) tasks.set(id, applyEvent(current, e));
  }
  return [...tasks.values()];
}

const SLUG_MAX = 32;

/** A branch name for a new task: `brigade/<words-of-the-title>-<id suffix>`. */
export function branchFor(taskId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  const suffix = taskId.replace(/^task-/, "");
  return `brigade/${slug ? `${slug}-` : ""}${suffix}`;
}
