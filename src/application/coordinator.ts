import type { AgentContext } from "../domain/agent.ts";
import type { ProjectConfig } from "../domain/config.ts";
import { BrigadeError } from "../domain/errors.ts";
import { prLine } from "../domain/pullRequests.ts";
import { deriveTasks } from "../domain/tasks.ts";
import { refreshPrs } from "./publish.ts";
import { findTerminals, launchAgent, record, terminalName } from "./launch.ts";
import type { Deps, Workspace } from "./ports.ts";

export function projectNamed(deps: Deps, name: string): ProjectConfig {
  const project = deps.config.projects.find((p) => p.name === name);
  if (project) return project;
  const known = deps.config.projects.map((p) => p.name).join(", ") || "none yet";
  throw new BrigadeError(`No project "${name}". Projects: ${known}.`);
}

/**
 * Starts the Coordinator unless one is running. Returns its address and whether it was already there. It continues
 * the newest conversation in its folder, or starts a new one when `fresh` is set; a fresh start refuses while one runs.
 */
export async function startCoordinator(
  deps: Deps,
  options: { fresh?: boolean } = {},
): Promise<{ address: string; started: boolean }> {
  const [running] = await findTerminals(deps, { role: "coordinator" });
  if (running && options.fresh) {
    throw new BrigadeError(
      `A Coordinator is running in ${running.address}. Stop it with "hc kill ${running.address}", then run "brigade start --new" again.`,
    );
  }
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
      resume: !options.fresh,
    },
    (terminal) => ({ kind: "agent_started", role: "coordinator", project: null, terminal, spec }),
  );
  return { address, started: true };
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Shows the terminal's tab, then turns core keep off on it, also when showing failed: herdr-app turns it on. */
async function openTab(deps: Deps, workspace: Workspace, address: string, first: boolean): Promise<void> {
  try {
    await workspace.open(address, { first });
  } finally {
    await deps.terminals.keepOff(address);
  }
}

/** Turns core keep off on every brigade terminal, past any failure. Returns one line per failure. */
async function keepOffAll(deps: Deps): Promise<string[]> {
  const failed: string[] = [];
  try {
    for (const t of await findTerminals(deps, {})) {
      await deps.terminals.keepOff(t.address).catch((err: unknown) => failed.push(messageOf(err)));
    }
  } catch (err) {
    failed.push(messageOf(err));
  }
  return failed;
}

/** The Coordinator in tab 1, a tab for each running Captain, and the Coordinator shown last. */
async function openTabs(deps: Deps, workspace: Workspace, coordinator: string): Promise<void> {
  await openTab(deps, workspace, coordinator, true);
  for (const captain of await findTerminals(deps, { role: "captain" }))
    await openTab(deps, workspace, captain.address, false);
  await openTab(deps, workspace, coordinator, true);
}

/**
 * `brigade start`: checks the window and hc, starts the Coordinator unless it runs, and opens it and the running
 * Captains in the Brigade space. Core keep is turned off on every brigade terminal at the end, also after a failure.
 */
export async function openBrigade(
  deps: Deps,
  workspace: Workspace,
  options: { fresh?: boolean } = {},
): Promise<{ address: string; started: boolean }> {
  await workspace.check();
  await findTerminals(deps, {}).catch((err: unknown) => {
    throw new BrigadeError(`hc is not answering. Check it with "hc server status". (${messageOf(err)})`);
  });
  const errors: string[] = [];
  let result: { address: string; started: boolean } | null = null;
  try {
    result = await startCoordinator(deps, options);
    await openTabs(deps, workspace, result.address);
  } catch (err) {
    errors.push(messageOf(err));
  }
  errors.push(...(await keepOffAll(deps)));
  if (errors.length > 0 || result === null) throw new BrigadeError([...new Set(errors)].join("\n"));
  return result;
}

/** `brigade open <address>`: shows a Coordinator's or a Captain's tab. Workers are shown over the tab (peek) instead. */
export async function openAgent(deps: Deps, workspace: Workspace, address: string): Promise<void> {
  await workspace.check();
  const coordinators = await findTerminals(deps, { role: "coordinator" });
  const captains = await findTerminals(deps, { role: "captain" });
  const isCoordinator = coordinators.some((t) => t.address === address);
  if (!isCoordinator && !captains.some((t) => t.address === address))
    throw new BrigadeError(`${address} is not a running Coordinator or Captain.`);
  await openTab(deps, workspace, address, isCoordinator);
}

/**
 * Starts a project's Captain with `firstMessage` as its first input. It runs in a folder of its own, so the newest
 * conversation there is always its own to continue, and it reads the repo from there.
 */
async function startCaptain(
  deps: Deps,
  ctx: AgentContext,
  project: ProjectConfig,
  firstMessage: string,
): Promise<void> {
  const spec = deps.config.roles.captain;
  const folder = `${deps.captainsFolder}/${project.name}`;
  await deps.folders.ensure(folder);
  await launchAgent(
    deps,
    {
      spec,
      name: terminalName.captain(project.name),
      cwd: folder,
      readDirs: [project.repo],
      resume: true,
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
