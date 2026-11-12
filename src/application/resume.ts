import { BrigadeError } from "../domain/errors.ts";
import { deriveNotes } from "../domain/notes.ts";
import { deriveTasks, type TaskView } from "../domain/tasks.ts";
import { findTerminals, launchAgent, terminalName } from "./launch.ts";
import { notesBlock } from "./notes.ts";
import type { Deps } from "./ports.ts";

/** The values a worker's prompt is rendered with, at start and at resume. */
export async function workerPromptValues(
  deps: Deps,
  t: { project: string; task: string; title: string; branch: string },
): Promise<Record<string, string>> {
  const notes = notesBlock(deriveNotes(await deps.events.read(), t.project).notes, deps.config.owner);
  return { PROJECT: t.project, TASK: t.task, TITLE: t.title, BRANCH: t.branch, NOTES: notes };
}

/** A task by its id, from the event log. */
export async function taskNamed(deps: Deps, id: string): Promise<TaskView | null> {
  return deriveTasks(await deps.events.read()).find((t) => t.id === id) ?? null;
}

/** The worker's terminal, and whether brigade resumed it just now. */
export interface WorkerAt {
  readonly address: string;
  readonly resumed: boolean;
}

/**
 * The task's running worker, or its ended worker resumed: it continues the newest conversation in the task's
 * worktree, the only folder it runs in. It keeps the task's own model, limits and repo, and reports to the project's
 * running Captain. One resume per task at a time, across processes; the check for a running worker is inside the lock.
 */
export async function workerFor(deps: Deps, task: TaskView): Promise<WorkerAt> {
  return deps.locks.withLock(task.id, async () => {
    const [running] = await findTerminals(deps, { role: "worker", task: task.id });
    if (running) return { address: running.address, resumed: false };
    return { address: await resume(deps, task), resumed: true };
  });
}

async function resume(deps: Deps, task: TaskView): Promise<string> {
  const [captain] = await findTerminals(deps, { role: "captain", project: task.project });
  if (!captain) throw new BrigadeError(`Start the ${task.project} Captain first: ask the Coordinator.`);
  if (task.repo === null)
    throw new BrigadeError(`${task.id} has no pinned repo (it is from before phase 2), so its worker can't resume.`);
  const repo = task.repo;
  await deps.worktrees
    .verify({ worktree: task.worktree, repo, branch: task.branch, runHooks: false })
    .catch((err: unknown) => {
      const why = err instanceof Error ? err.message : String(err);
      throw new BrigadeError(`The worktree of ${task.id} is gone or changed, so its worker can't resume. ${why}`);
    });
  const { project, id, title, branch } = task;
  return launchAgent(
    deps,
    {
      spec: task.spec,
      name: terminalName.worker(id),
      cwd: task.worktree,
      context: { role: "worker", project, task: id, title, parent: captain.address },
      firstMessage: null,
      promptValues: await workerPromptValues(deps, { project, task: id, title, branch }),
      // A worktree's commits land in the main repo's .git folder, outside the worktree.
      writableDirs: [`${repo}/.git`],
      resume: true,
      resumeOnly: true,
    },
    (terminal) => ({ kind: "worker_resumed", project, task: id, terminal }),
  );
}
