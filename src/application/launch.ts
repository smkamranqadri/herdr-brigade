import type { AgentSpec } from "../domain/agent.ts";
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
}

/** Starts one agent in a new hc terminal, answers its trust prompt, and returns its address. */
export async function launchAgent(deps: Deps, a: AgentLaunch): Promise<string> {
  const { role, project, task, title, parent } = a.context;
  const systemPrompt = await deps.prompts.render(role, { OWNER: deps.config.owner, ...a.promptValues });
  const plan = await deps.harnesses.prepare({
    role,
    spec: a.spec,
    agentId: a.name,
    systemPrompt,
    firstMessage: a.firstMessage,
    mcp: deps.mcpFor(a.context),
  });
  const labels: Record<string, string> = { [BRIGADE_LABEL]: BRIGADE_VALUE, role, harness: a.spec.harness };
  if (project) labels.project = project;
  if (task) labels.task = task;
  if (title) labels.title = title;
  const address = await deps.terminals.launch({ name: a.name, cwd: a.cwd, labels, parent, argv: plan.argv });
  if (plan.trust) await deps.terminals.answerTrust(address, plan.trust);
  return address;
}

export async function record(deps: Deps, event: NewEvent): Promise<void> {
  await deps.events.append({ ...event, at: deps.clock.now().toISOString() });
}

/** Live brigade terminals with all of these labels. */
export async function findTerminals(deps: Deps, match: Readonly<Record<string, string>>): Promise<TerminalInfo[]> {
  return deps.terminals.find({ [BRIGADE_LABEL]: BRIGADE_VALUE, ...match });
}
