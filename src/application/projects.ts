import type { AgentContext } from "../domain/agent.ts";
import { withBaseBranch, withProject } from "../domain/config.ts";
import { BrigadeError } from "../domain/errors.ts";
import { githubRepoOf } from "../domain/github.ts";
import { record } from "./launch.ts";
import type { Deps } from "./ports.ts";

function onlyCoordinator(ctx: AgentContext): void {
  if (ctx.role !== "coordinator") throw new BrigadeError("Only the Coordinator manages projects.");
}

/** Git repos in the owner's repo folders whose name matches, as text for the agent. */
export async function findRepo(deps: Deps, ctx: AgentContext, input: { name: string }): Promise<string> {
  onlyCoordinator(ctx);
  const roots = deps.config.repoRoots ?? deps.defaultRepoRoots;
  const found = await deps.repos.find(roots, input.name);
  if (!found.length)
    return `No git repo named like "${input.name}" in ${roots.join(", ")}. Ask the owner for the path.`;
  return found.map((r) => `${r.name}: ${r.path}`).join("\n");
}

/**
 * Adds a project for a local git repo. Its GitHub repo, if `origin` is on github.com, is pinned now: agents can't
 * change it later, and publishing goes only there.
 */
export async function addProject(
  deps: Deps,
  ctx: AgentContext,
  input: { name: string; repo: string; baseBranch?: string },
): Promise<string> {
  onlyCoordinator(ctx);
  const repo = input.repo.replace(/\/+$/, "");
  if (!repo.startsWith("/")) throw new BrigadeError(`The repo must be an absolute path, not "${input.repo}".`);
  const facts = await deps.repos.inspect(repo);
  if (!facts) throw new BrigadeError(`${repo} is not a git repo.`);
  if (!facts.isRoot) throw new BrigadeError(`${repo} is inside a git repo; give the repo's top folder.`);
  const baseBranch = input.baseBranch ?? facts.currentBranch;
  if (!baseBranch) throw new BrigadeError(`${repo} is not on a branch; give the base branch.`);
  if (!(await deps.repos.hasBranch(repo, baseBranch))) throw new BrigadeError(`${repo} has no branch "${baseBranch}".`);
  const github = facts.origin ? githubRepoOf(facts.origin) : null;
  await deps.configStore.update((c) => withProject(c, { name: input.name, repo, baseBranch, github }));
  await record(deps, { kind: "project_added", project: input.name, repo, baseBranch, github });
  const publish = github
    ? `It publishes pull requests to github.com/${github}.`
    : "It has no GitHub origin, so it can't publish.";
  return `Added project ${input.name}: ${repo}, base branch ${baseBranch}. ${publish}`;
}

/** Changes the base branch new tasks start from. Running tasks keep theirs. */
export async function updateProject(
  deps: Deps,
  ctx: AgentContext,
  input: { name: string; baseBranch: string },
): Promise<string> {
  onlyCoordinator(ctx);
  const project = deps.config.projects.find((p) => p.name === input.name);
  if (!project) throw new BrigadeError(`No project "${input.name}".`);
  if (!(await deps.repos.hasBranch(project.repo, input.baseBranch))) {
    throw new BrigadeError(`${project.repo} has no branch "${input.baseBranch}".`);
  }
  await deps.configStore.update((c) => withBaseBranch(c, input.name, input.baseBranch));
  await record(deps, { kind: "project_changed", project: input.name, baseBranch: input.baseBranch });
  return `Project ${input.name} now starts new tasks from ${input.baseBranch}. Running tasks keep their base branch.`;
}
