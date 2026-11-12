import type { AgentSpec } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import type { NewEvent } from "../domain/events.ts";
import type { Deps, LaunchContext, TerminalInfo, TerminalLaunch } from "./ports.ts";

/** The label every brigade terminal carries, with the instance as its value, so brigade and the mod find them. */
const BRIGADE_LABEL = "brigade";

export const terminalName = {
  coordinator: () => "bg-coordinator",
  captain: (project: string) => `bg-cap-${project}`,
  worker: (task: string) => `bg-${task}`,
};

export interface AgentLaunch {
  readonly spec: AgentSpec;
  readonly name: string;
  readonly cwd: string;
  readonly context: LaunchContext;
  readonly firstMessage: string | null;
  readonly promptValues: Readonly<Record<string, string>>;
  /** See HarnessLaunchRequest.writableDirs; none by default. */
  readonly writableDirs?: readonly string[];
  /** See HarnessLaunchRequest.readDirs; none by default. */
  readonly readDirs?: readonly string[];
  /** See HarnessLaunchRequest.resume; a new session by default. */
  readonly resume?: boolean;
  /**
   * Resume or fail: when the agent finds no session, or never becomes ready, its terminal is removed and the launch
   * fails. No retry in a new session. For a worker, whose brief is only in its old conversation.
   */
  readonly resumeOnly?: boolean;
}

/**
 * Starts one agent in a new hc terminal and returns its address. `started` names the event to record: it is
 * recorded as soon as the terminal exists, before the agent can act, so no report from it can come first.
 * Then the trust prompt is answered; if the agent shows neither the prompt nor its ready screen in time, it fails.
 * An agent asked to resume that finds no session ends at once: its terminal is removed, and it starts once more with
 * a new session. Its first message still arrives once: the first start ended before it read it.
 */
export async function launchAgent(deps: Deps, a: AgentLaunch, started: (address: string) => NewEvent): Promise<string> {
  const outcome = await launchOnce(deps, a, started);
  if (outcome.result === "started") return outcome.address;
  if (a.resumeOnly) return removeAndFail(deps, a, outcome.address, outcome.result);
  if (outcome.result === "timeout") throw notReady(a.context.role, outcome.address);
  await deps.terminals.remove(outcome.address);
  const retry = await launchOnce(deps, { ...a, resume: false }, started);
  if (retry.result !== "started") throw notReady(a.context.role, retry.address);
  return retry.address;
}

/** A resume-only launch that did not start: its terminal goes, so the next try starts clean. */
async function removeAndFail(
  deps: Deps,
  a: AgentLaunch,
  address: string,
  why: "no_session" | "timeout",
): Promise<never> {
  await deps.terminals.remove(address);
  const what =
    why === "no_session"
      ? `found no conversation to continue in ${a.cwd}`
      : `in terminal ${address} never became ready`;
  throw new BrigadeError(`The ${a.context.role} ${what}, so brigade removed it.`);
}

function notReady(role: string, address: string): BrigadeError {
  return new BrigadeError(
    `The ${role} in terminal ${address} started but never became ready. It may be stuck on a prompt: check it with "hc read ${address}".`,
  );
}

/** The labels brigade and the mod find an agent's terminal by. */
function labelsFor(instance: string, a: AgentLaunch): Record<string, string> {
  const { role, project, task, title } = a.context;
  const labels: Record<string, string> = { [BRIGADE_LABEL]: instance, role, harness: a.spec.harness };
  if (project) labels.project = project;
  if (task) labels.task = task;
  if (title) labels.title = title;
  return labels;
}

function terminalFor(instance: string, a: AgentLaunch, argv: readonly string[]): TerminalLaunch {
  const { name, cwd, context } = a;
  // A Captain ends with the Coordinator; a worker keeps running, so a closed space does not lose its work.
  const outliveParent = context.role === "worker";
  return { name, cwd, labels: labelsFor(instance, a), parent: context.parent, outliveParent, argv };
}

/** One start. On no_session or timeout it stops there: nothing was typed in, so the caller decides. */
async function launchOnce(
  deps: Deps,
  a: AgentLaunch,
  started: (address: string) => NewEvent,
): Promise<{ address: string; result: "started" | "no_session" | "timeout" }> {
  const { role } = a.context;
  const systemPrompt = await deps.prompts.render(role, { OWNER: deps.config.owner, ...a.promptValues });
  const plan = await deps.harnesses.prepare({
    role,
    spec: a.spec,
    agentId: a.name,
    systemPrompt,
    firstMessage: a.firstMessage,
    mcp: deps.mcpFor(a.context),
    writableDirs: a.writableDirs ?? [],
    readDirs: a.readDirs ?? [],
    resume: a.resume ?? false,
  });
  const address = await deps.terminals.launch(terminalFor(deps.instance, a, plan.argv));
  await record(deps, started(address));
  const trust = plan.trust ? await deps.terminals.answerTrust(address, plan.trust) : "ready";
  if (trust === "timeout" || trust === "no_session") return { address, result: trust };
  if (plan.sendFirst !== null) await deps.terminals.send(address, plan.sendFirst);
  return { address, result: "started" };
}

export async function record(deps: Deps, event: NewEvent): Promise<void> {
  await deps.events.append({ ...event, at: deps.clock.now().toISOString() });
}

/** Live brigade terminals with all of these labels. */
export async function findTerminals(deps: Deps, match: Readonly<Record<string, string>>): Promise<TerminalInfo[]> {
  return deps.terminals.find({ [BRIGADE_LABEL]: deps.instance, ...match });
}
