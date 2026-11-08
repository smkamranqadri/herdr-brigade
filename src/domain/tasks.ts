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
  readonly state: TaskState;
  /** The last summary or question, if any. */
  readonly note: string | null;
  readonly updatedAt: string;
}

/** Folds the event log into one view per task, in the order the tasks were created. */
export function deriveTasks(events: readonly BrigadeEvent[]): TaskView[] {
  const tasks = new Map<string, TaskView>();
  for (const e of events) {
    if (e.kind === "task_created") {
      const { project, task, title, branch, worktree, terminal, spec, at } = e;
      tasks.set(task, {
        id: task,
        project,
        title,
        branch,
        worktree,
        terminal,
        spec,
        state: "working",
        note: null,
        updatedAt: at,
      });
      continue;
    }
    const current = e.kind === "task_finished" || e.kind === "task_asked" ? tasks.get(e.task) : undefined;
    if (!current) continue;
    if (e.kind === "task_finished")
      tasks.set(e.task, { ...current, state: "finished", note: e.summary, updatedAt: e.at });
    if (e.kind === "task_asked") tasks.set(e.task, { ...current, state: "asking", note: e.question, updatedAt: e.at });
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
