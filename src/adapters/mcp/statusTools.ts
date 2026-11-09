// The read-only status tools: repo_status for the Coordinator and Captains, herdr_agents for the Coordinator.
import type { Deps } from "../../application/ports.ts";
import { herdrAgents, repoStatus } from "../../application/status.ts";
import type { AgentContext } from "../../domain/agent.ts";
import { optStr, schema, str } from "./args.ts";
import type { Tool } from "./protocol.ts";

const REPO_STATUS =
  "Read a project's repo now, without changing it: branch, ahead/behind its upstream, uncommitted changes, recent commits, branches, worktrees and open pull requests. Use it for any status question; you have no shell.";

export function coordinatorStatusTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    repo_status: {
      description: REPO_STATUS,
      inputSchema: schema(["project"], { project: "Project name from list_projects." }),
      run: (a) => repoStatus(deps, ctx, { project: str(a, "project") }),
    },
    herdr_agents: {
      description:
        "Every live terminal in Herdr, the owner's own agents and shells too, with program, status, space/tab and folder. Brigade's are marked. Read only.",
      inputSchema: schema([], {}),
      run: () => herdrAgents(deps, ctx),
    },
  };
}

export function captainStatusTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    repo_status: {
      description: REPO_STATUS,
      inputSchema: schema([], { project: "Optional: your own project's name." }),
      run: (a) => {
        const project = optStr(a, "project");
        return repoStatus(deps, ctx, project === undefined ? {} : { project });
      },
    },
  };
}
