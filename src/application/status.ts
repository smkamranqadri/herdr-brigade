// Read-only views for the routing roles, which have no shell: a project's repo state, and the owner's Herdr agents.
// brigade reads them itself, outside any agent, and changes nothing.
import type { AgentContext } from "../domain/agent.ts";
import type { ProjectConfig } from "../domain/config.ts";
import { BrigadeError } from "../domain/errors.ts";
import { projectNamed } from "./coordinator.ts";
import { findTerminals } from "./launch.ts";
import type { Deps, HerdrTerminal, RepoStatus } from "./ports.ts";

/** The project a status call is about. The Coordinator may name any project; a Captain gets only its own. */
function statusProject(deps: Deps, ctx: AgentContext, asked: string | undefined): ProjectConfig {
  if (ctx.role === "captain") {
    if (asked !== undefined && asked !== ctx.project)
      throw new BrigadeError(`Out of scope: ${asked} is not your project.`);
    return projectNamed(deps, ctx.project ?? "");
  }
  if (ctx.role !== "coordinator") throw new BrigadeError("Only the Coordinator and Captains read repo status.");
  if (!asked) throw new BrigadeError("Name the project: repo_status(project).");
  return projectNamed(deps, asked);
}

function branchLine(s: RepoStatus): string {
  const branch = s.branch ?? "a detached HEAD";
  if (!s.upstream) return `Branch: ${branch}, with no upstream.`;
  const { name, ahead, behind } = s.upstream;
  return `Branch: ${branch}, ${ahead} ahead and ${behind} behind ${name}.`;
}

function changesLine(s: RepoStatus): string {
  const { staged, unstaged, untracked, files } = s.changes;
  if (staged + unstaged + untracked === 0) return "Uncommitted changes: none.";
  return `Uncommitted changes: ${staged} staged, ${unstaged} unstaged, ${untracked} untracked (${files.join(", ")}).`;
}

async function pullRequestsLine(deps: Deps, github: string | null): Promise<string> {
  if (!github) return "Open pull requests: none known; the project has no GitHub repo.";
  try {
    const open = await deps.github.openPullRequests(github);
    if (!open.length) return `Open pull requests on ${github}: none.`;
    const list = open.map((p) => `#${p.number} "${p.title}" (${p.head}${p.isDraft ? ", draft" : ""})`);
    return `Open pull requests on ${github}: ${list.join("; ")}.`;
  } catch (err) {
    return `Open pull requests on ${github}: couldn't read GitHub (${err instanceof Error ? err.message : String(err)}).`;
  }
}

/** A project's repo state and open pull requests, read now by brigade. It changes nothing in the repo. */
export async function repoStatus(deps: Deps, ctx: AgentContext, input: { project?: string }): Promise<string> {
  const project = statusProject(deps, ctx, input.project);
  const s = await deps.repos.status(project.repo);
  const checked = `${deps.clock.now().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return [
    `${project.name} (${project.repo}), checked ${checked}.`,
    branchLine(s),
    changesLine(s),
    `Last commits: ${s.commits.map((c) => `${c.sha} ${c.date} ${c.subject}`).join(" | ") || "none"}.`,
    `Branches: ${s.branches.map((b) => `${b.name} (${b.date})`).join(", ") || "none"}.`,
    `Worktrees: ${s.worktrees.map((w) => `${w.path} (${w.branch ?? "detached"})`).join(", ")}.`,
    await pullRequestsLine(deps, project.github),
  ].join("\n");
}

function agentLine(t: HerdrTerminal, brigade: ReadonlySet<string>): string {
  const parts = [t.program ?? "shell", t.status ?? "no status", t.where ?? "no pane", t.cwd ?? "unknown folder"];
  return `${t.address}: ${parts.join(" · ")}${brigade.has(t.address) ? " (brigade)" : ""}`;
}

/** Every live terminal in Herdr, the owner's own agents too. The Coordinator only; it changes nothing. */
export async function herdrAgents(deps: Deps, ctx: AgentContext): Promise<string> {
  if (ctx.role !== "coordinator") throw new BrigadeError("Only the Coordinator lists Herdr's agents.");
  const [all, ours] = await Promise.all([deps.terminals.all(), findTerminals(deps, {})]);
  if (!all.length) return "No live terminals in Herdr.";
  const brigade = new Set(ours.map((t) => t.address));
  const agents = all.filter((t) => t.program !== null && t.program !== "bash").length;
  return [`${all.length} live terminals, ${agents} of them agents:`, ...all.map((t) => agentLine(t, brigade))].join(
    "\n",
  );
}
