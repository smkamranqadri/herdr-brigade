import type { AgentContext } from "../domain/agent.ts";
import type { ProjectConfig } from "../domain/config.ts";
import { BrigadeError } from "../domain/errors.ts";
import { prLine } from "../domain/pullRequests.ts";
import { deriveTasks } from "../domain/tasks.ts";
import { refreshPrs } from "./publish.ts";
import { findTerminals, launchAgent, record, terminalName } from "./launch.ts";
import type { Deps } from "./ports.ts";

export function projectNamed(deps: Deps, name: string): ProjectConfig {
  const project = deps.config.projects.find((p) => p.name === name);
  if (project) return project;
  const known = deps.config.projects.map((p) => p.name).join(", ") || "none yet";
  throw new BrigadeError(`No project "${name}". Projects: ${known}.`);
}

/** Starts the Coordinator unless one is running. Returns its address and whether it was already there. */
export async function startCoordinator(deps: Deps): Promise<{ address: string; started: boolean }> {
  const [running] = await findTerminals(deps, { role: "coordinator" });
  if (running) return { address: running.address, started: false };
  const spec = deps.config.roles.coordinator;
  const address = await launchAgent(
    deps,
    {
      spec,
      name: terminalName.coordinator(),
      cwd: deps.coordinatorFolder,
      context: { role: "coordinator", project: null, task: null, title: null, parent: null },
      firstMessage: null,
      promptValues: { PROJECTS: deps.config.projects.map((p) => p.name).join(", ") || "none yet" },
    },
    (terminal) => ({ kind: "agent_started", role: "coordinator", project: null, terminal, spec }),
  );
  return { address, started: true };
}

/** Starts a project's Captain in its repo, with `firstMessage` as its first input. */
async function startCaptain(
  deps: Deps,
  ctx: AgentContext,
  project: ProjectConfig,
  firstMessage: string,
): Promise<void> {
  const spec = deps.config.roles.captain;
  await launchAgent(
    deps,
    {
      spec,
      name: terminalName.captain(project.name),
      cwd: project.repo,
      context: { role: "captain", project: project.name, task: null, title: null, parent: ctx.terminal },
      firstMessage,
      promptValues: { PROJECT: project.name, REPO: project.repo, BASE_BRANCH: project.baseBranch },
    },
    (terminal) => ({ kind: "agent_started", role: "captain", project: project.name, terminal, spec }),
  );
}

/** Sends work to a project's Captain, starting the Captain first if it isn't running. */
export async function sendToCaptain(
  deps: Deps,
  ctx: AgentContext,
  input: { project: string; message: string },
): Promise<string> {
  const project = projectNamed(deps, input.project);
  const text = `[brigade] From the Coordinator: ${input.message}`;
  const [captain] = await findTerminals(deps, { role: "captain", project: project.name });
  if (captain) await deps.terminals.send(captain.address, text);
  else await startCaptain(deps, ctx, project, text);
  await record(deps, {
    kind: "message_sent",
    from: "coordinator",
    to: "captain",
    project: project.name,
    task: null,
    text: input.message,
  });
  return `Sent to the ${project.name} Captain${captain ? "" : ", which was started for it"}. End your turn; its report arrives as a [brigade] message.`;
}

export function listProjects(deps: Deps): string {
  if (!deps.config.projects.length)
    return "No projects yet. The owner adds them in ~/.config/herdr-brigade/config.json.";
  return deps.config.projects.map((p) => `${p.name}: ${p.repo} (base branch ${p.baseBranch})`).join("\n");
}

/** The tasks of one project, or of every project, with each one's state and live terminal status. */
export async function listTasks(deps: Deps, project: string | null): Promise<string> {
  const tasks = deriveTasks(await deps.events.read()).filter((t) => project === null || t.project === project);
  if (!tasks.length) return project ? `No tasks in ${project} yet.` : "No tasks yet.";
  const live = new Map((await findTerminals(deps, {})).map((t) => [t.address, t.status ?? "running"]));
  const prs = await refreshPrs(
    deps,
    tasks.map((t) => t.id),
  );
  const now = deps.clock.now();
  return tasks
    .map((t) => {
      const status = live.get(t.terminal) ?? "not running";
      const note = t.note ? `: ${t.note}` : "";
      const pr = prs.get(t.id);
      const prText = pr ? ` ${prLine(pr, now)}` : "";
      return `${t.id} [${t.project}] "${t.title}" ${t.state} (terminal ${t.terminal}, ${status}, ${t.spec.harness})${prText}${note}`;
    })
    .join("\n");
}
