import type { AgentContext } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import { deriveTasks } from "../domain/tasks.ts";
import { record } from "./launch.ts";
import type { Deps } from "./ports.ts";

interface WorkerIdentity {
  readonly project: string;
  readonly task: string;
  readonly title: string;
  readonly captain: string;
}

function identity(ctx: AgentContext): WorkerIdentity {
  const { project, task, title, parent } = ctx;
  if (ctx.role !== "worker" || !project || !task || !title || !parent) {
    throw new BrigadeError("Only a worker started by a Captain can do this.");
  }
  return { project, task, title, captain: parent };
}

const label = (w: WorkerIdentity) => `[brigade] Task ${w.task} "${w.title}"`;

export async function finishTask(deps: Deps, ctx: AgentContext, input: { summary: string }): Promise<string> {
  const w = identity(ctx);
  await record(deps, { kind: "task_finished", task: w.task, summary: input.summary });
  await deps.terminals.send(w.captain, `${label(w)} finished: ${input.summary}`);
  return "Sent to your Captain. End your turn now.";
}

export async function askOwner(deps: Deps, ctx: AgentContext, input: { question: string }): Promise<string> {
  const w = identity(ctx);
  await record(deps, { kind: "task_asked", task: w.task, question: input.question });
  await deps.terminals.send(w.captain, `${label(w)} asks the owner: ${input.question}`);
  return "Sent to your Captain, who passes it to the owner. End your turn now; the answer arrives as your next message.";
}

/** A note or question for the Captain, without ending the turn. */
export async function messageCaptain(deps: Deps, ctx: AgentContext, input: { text: string }): Promise<string> {
  const w = identity(ctx);
  await deps.terminals.send(w.captain, `${label(w)} says: ${input.text}`);
  await record(deps, {
    kind: "message_sent",
    from: "worker",
    to: "captain",
    project: w.project,
    task: w.task,
    text: input.text,
  });
  return "Sent to your Captain. Carry on; any reply arrives as a later message.";
}

/** Commits the worker's changes in its own worktree, found from the event log, never from the agent's input. */
export async function commitWork(deps: Deps, ctx: AgentContext, input: { message: string }): Promise<string> {
  const w = identity(ctx);
  const task = deriveTasks(await deps.events.read()).find((t) => t.id === w.task);
  if (!task) throw new BrigadeError(`Brigade has no record of ${w.task}, so it can't find your worktree.`);
  const commit = await deps.worktrees.commit(task.worktree, input.message);
  if (!commit) return "Nothing to commit: your worktree has no changes.";
  await record(deps, { kind: "task_committed", task: w.task, sha: commit.sha, message: input.message });
  return `Committed ${commit.files} file${commit.files === 1 ? "" : "s"} as ${commit.sha} on ${task.branch}.`;
}
