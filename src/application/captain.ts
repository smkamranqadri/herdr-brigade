import { isEffort, isHarness, type AgentContext, type AgentSpec } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import { branchFor, deriveTasks } from "../domain/tasks.ts";
import { projectNamed } from "./coordinator.ts";
import { findTerminals, launchAgent, record, terminalName } from "./launch.ts";
import type { Deps } from "./ports.ts";

export interface CreateTaskInput {
  readonly title: string;
  readonly prompt: string;
  readonly harness?: string;
  readonly model?: string;
  readonly effort?: string;
}

function ownProject(ctx: AgentContext): string {
  if (!ctx.project) throw new BrigadeError("Only a Captain can do this: this agent has no project.");
  return ctx.project;
}

/** The worker's spec: the config's, with any per-task choice on top. A new harness needs its own model. */
export function workerSpec(base: AgentSpec, input: CreateTaskInput): AgentSpec {
  const harness = input.harness ?? base.harness;
  if (!isHarness(harness)) throw new BrigadeError(`Unknown harness "${harness}". Use claude, codex or pi.`);
  if (harness !== base.harness && !input.model) {
    throw new BrigadeError(`Give a model for ${harness}: the default model "${base.model}" is for ${base.harness}.`);
  }
  const effort = input.effort ?? base.effort;
  if (!isEffort(effort)) throw new BrigadeError(`Unknown effort "${effort}". Use low, medium, high, xhigh or max.`);
  return { harness, model: input.model ?? base.model, effort, permissions: base.permissions };
}

/** Starts a worker for one new task, in its own branch and worktree. */
export async function createTask(deps: Deps, ctx: AgentContext, input: CreateTaskInput): Promise<string> {
  const project = projectNamed(deps, ownProject(ctx));
  const spec = workerSpec(deps.config.roles.worker, input);
  const task = deps.ids.taskId();
  const branch = branchFor(task, input.title);
  const worktree = await deps.worktrees.create(project.repo, project.baseBranch, branch);
  const terminal = await launchAgent(
    deps,
    {
      spec,
      name: terminalName.worker(task),
      cwd: worktree,
      context: { role: "worker", project: project.name, task, title: input.title, parent: ctx.terminal },
      firstMessage: input.prompt,
      promptValues: { PROJECT: project.name, TASK: task, TITLE: input.title, BRANCH: branch },
    },
    (terminal) => ({
      kind: "task_created",
      project: project.name,
      task,
      title: input.title,
      branch,
      worktree,
      terminal,
      spec,
    }),
  );
  return `Started ${task} "${input.title}" on ${spec.harness} (${spec.model}) in terminal ${terminal}, branch ${branch}. End your turn; its report arrives as a [brigade] message.`;
}

/** Sends a follow-up to a task's worker, which picks it up in the same session. */
export async function sendToTask(
  deps: Deps,
  ctx: AgentContext,
  input: { task: string; message: string },
): Promise<string> {
  const project = ownProject(ctx);
  const task = deriveTasks(await deps.events.read()).find((t) => t.id === input.task);
  if (!task || task.project !== project)
    throw new BrigadeError(`No task ${input.task} in ${project}. Call list_tasks.`);
  const [worker] = await findTerminals(deps, { role: "worker", task: task.id });
  if (!worker)
    throw new BrigadeError(`The worker for ${task.id} is not running, so it can't take a follow-up. Start a new task.`);
  await deps.terminals.send(worker.address, `[brigade] From your Captain: ${input.message}`);
  await record(deps, {
    kind: "message_sent",
    from: "captain",
    to: "worker",
    project,
    task: task.id,
    text: input.message,
  });
  return `Sent to ${task.id}. End your turn; its report arrives as a [brigade] message.`;
}

/** Sends the Captain's result to the Coordinator. */
export async function reportToCoordinator(deps: Deps, ctx: AgentContext, input: { text: string }): Promise<string> {
  const project = ownProject(ctx);
  const [coordinator] = await findTerminals(deps, { role: "coordinator" });
  if (!coordinator) throw new BrigadeError("The Coordinator is not running. Tell the owner in your reply instead.");
  await deps.terminals.send(coordinator.address, `[brigade] Captain for ${project}: ${input.text}`);
  await record(deps, {
    kind: "message_sent",
    from: "captain",
    to: "coordinator",
    project,
    task: null,
    text: input.text,
  });
  return "Sent to the Coordinator.";
}
