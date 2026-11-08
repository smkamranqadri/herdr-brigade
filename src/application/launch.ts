import type { AgentSpec } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import type { NewEvent } from "../domain/events.ts";
import type { Deps, LaunchContext, TerminalInfo } from "./ports.ts";

/** The label every brigade terminal carries, so brigade and the mod can find them. */
const BRIGADE_LABEL = "brigade";
const BRIGADE_VALUE = "main";

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
}

/**
 * Starts one agent in a new hc terminal and returns its address. `started` names the event to record: it is
 * recorded as soon as the terminal exists, before the agent can act, so no report from it can come first.
 * Then the trust prompt is answered; if the agent shows neither the prompt nor its ready screen in time, it fails.
 */
export async function launchAgent(deps: Deps, a: AgentLaunch, started: (address: string) => NewEvent): Promise<string> {
  const { role, project, task, title, parent } = a.context;
  const systemPrompt = await deps.prompts.render(role, { OWNER: deps.config.owner, ...a.promptValues });
  const plan = await deps.harnesses.prepare({
    role,
    spec: a.spec,
    agentId: a.name,
    systemPrompt,
    firstMessage: a.firstMessage,
    mcp: deps.mcpFor(a.context),
    writableDirs: a.writableDirs ?? [],
  });
  const labels: Record<string, string> = { [BRIGADE_LABEL]: BRIGADE_VALUE, role, harness: a.spec.harness };
  if (project) labels.project = project;
  if (task) labels.task = task;
  if (title) labels.title = title;
  const address = await deps.terminals.launch({ name: a.name, cwd: a.cwd, labels, parent, argv: plan.argv });
  await record(deps, started(address));
  if (plan.trust && (await deps.terminals.answerTrust(address, plan.trust)) === "timeout") {
    throw new BrigadeError(
      `The ${role} in terminal ${address} started but never became ready. It may be stuck on a prompt: check it with "hc read ${address}".`,
    );
  }
  if (plan.sendFirst !== null) await deps.terminals.send(address, plan.sendFirst);
  return address;
}

export async function record(deps: Deps, event: NewEvent): Promise<void> {
  await deps.events.append({ ...event, at: deps.clock.now().toISOString() });
}

/** Live brigade terminals with all of these labels. */
export async function findTerminals(deps: Deps, match: Readonly<Record<string, string>>): Promise<TerminalInfo[]> {
  return deps.terminals.find({ [BRIGADE_LABEL]: BRIGADE_VALUE, ...match });
}
