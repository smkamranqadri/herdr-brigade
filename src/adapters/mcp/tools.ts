import { createTask, reportToCoordinator, sendToTask } from "../../application/captain.ts";
import { listProjects, listTasks, sendToCaptain } from "../../application/coordinator.ts";
import { addProject, findRepo, updateProject } from "../../application/projects.ts";
import { createPullRequest } from "../../application/publish.ts";
import type { Deps } from "../../application/ports.ts";
import { askOwner, commitWork, finishTask, messageCaptain } from "../../application/worker.ts";
import type { AgentContext, Role } from "../../domain/agent.ts";
import { BrigadeError } from "../../domain/errors.ts";
import { optStr, schema, str, type Args } from "./args.ts";
import { captainNoteTools, coordinatorNoteTools, workerNoteTools } from "./noteTools.ts";
import type { Tool } from "./protocol.ts";

function coordinatorTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    list_projects: {
      description: "The projects in this brigade, with their repos.",
      inputSchema: schema([], {}),
      run: () => Promise.resolve(listProjects(deps)),
    },
    send_to_captain: {
      description:
        "Send work or a follow-up to a project's Captain. Starts the Captain if it isn't running. Its report arrives later as a [brigade] message.",
      inputSchema: schema(["project", "message"], {
        project: "Project name from list_projects.",
        message: "A complete, self-contained brief.",
      }),
      run: (a) => sendToCaptain(deps, ctx, { project: str(a, "project"), message: str(a, "message") }),
    },
    list_tasks: {
      description: "Tasks with their state and live status. Optionally only one project's.",
      inputSchema: schema([], { project: "Only this project's tasks." }),
      run: (a) => listTasks(deps, optStr(a, "project") ?? null),
    },
  };
}

function createTaskTool(deps: Deps, ctx: AgentContext): Tool {
  return {
    description: "Start one worker for a new piece of work, in its own branch and worktree. Returns at once.",
    inputSchema: schema(["title", "prompt"], {
      title: "A short title.",
      prompt: "A self-contained brief: the goal, what not to touch, and what done means.",
      harness: "Optional: claude, codex or pi. Needs a model when it differs from the default.",
      model: "Optional model for this task.",
      effort: "Optional: low, medium, high, xhigh or max.",
    }),
    run: (a) => {
      const [harness, model, effort] = [optStr(a, "harness"), optStr(a, "model"), optStr(a, "effort")];
      return createTask(deps, ctx, {
        title: str(a, "title"),
        prompt: str(a, "prompt"),
        ...(harness && { harness }),
        ...(model && { model }),
        ...(effort && { effort }),
      });
    },
  };
}

function projectTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    find_repo: {
      description: "Find the owner's local git repos whose folder name matches, to add one as a project.",
      inputSchema: schema(["name"], { name: "Part of the repo's folder name, e.g. harbor." }),
      run: (a) => findRepo(deps, ctx, { name: str(a, "name") }),
    },
    add_project: {
      description:
        "Add a local git repo as a project. Its GitHub repo, if origin is on GitHub, is pinned now; pull requests go only there.",
      inputSchema: schema(["name", "repo"], {
        name: "Short name: 1-24 of a-z, 0-9 and -.",
        repo: "Absolute path of the repo's top folder (find_repo finds it).",
        baseBranch: "Optional: the branch tasks start from; default the repo's current branch.",
      }),
      run: (a) => {
        const baseBranch = optStr(a, "baseBranch");
        return addProject(deps, ctx, { name: str(a, "name"), repo: str(a, "repo"), ...(baseBranch && { baseBranch }) });
      },
    },
    update_project: {
      description:
        "Change the branch a project's new tasks start from. Its repo, GitHub repo and everything else change only by hand.",
      inputSchema: schema(["name", "baseBranch"], { name: "The project.", baseBranch: "The new base branch." }),
      run: (a) => updateProject(deps, ctx, { name: str(a, "name"), baseBranch: str(a, "baseBranch") }),
    },
  };
}

function captainTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    create_task: createTaskTool(deps, ctx),
    send_to_task: {
      description: "Send a follow-up or feedback to a task's worker, which keeps its context.",
      inputSchema: schema(["task", "message"], { task: "Task id, e.g. task-a1b2c3.", message: "The follow-up." }),
      run: (a) => sendToTask(deps, ctx, { task: str(a, "task"), message: str(a, "message") }),
    },
    list_tasks: {
      description: "This project's tasks, with their state and live status.",
      inputSchema: schema([], {}),
      run: () => listTasks(deps, ctx.project),
    },
    report: {
      description: "Send your result or a question for the owner to the Coordinator.",
      inputSchema: schema(["text"], { text: "Short and self-contained." }),
      run: (a) => reportToCoordinator(deps, ctx, { text: str(a, "text") }),
    },
  };
}

/** A worker's git tools: they run outside its sandbox, on its own checked worktree. */
function workerGitTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    commit: {
      description:
        "Commit every change in your worktree on your branch. Use this instead of git commit: it works inside any sandbox.",
      inputSchema: schema(["message"], { message: "The commit message: a short subject line, then any detail." }),
      run: (a) => commitWork(deps, ctx, { message: str(a, "message") }),
    },
    create_pull_request: {
      description:
        "Push your task branch and open its pull request against the project's base branch, or update the open one. Commit first.",
      inputSchema: schema(["title", "body"], {
        title: "The pull request's title.",
        body: "What changed and how it was checked.",
      }),
      run: (a) => createPullRequest(deps, ctx, { title: str(a, "title"), body: str(a, "body") }),
    },
  };
}

function workerTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    finish: {
      description: "Call when the task is complete. Sends your summary to your Captain. Then end your turn.",
      inputSchema: schema(["summary"], { summary: "One or two lines: what you did and where." }),
      run: (a) => finishTask(deps, ctx, { summary: str(a, "summary") }),
    },
    ask_user: {
      description: "Ask the owner a question you can't settle yourself. Then end your turn.",
      inputSchema: schema(["question"], { question: "One question, with your recommended answer." }),
      run: (a) => askOwner(deps, ctx, { question: str(a, "question") }),
    },
    message_captain: {
      description:
        "Tell your Captain something without ending your turn: a scope question, or a conflict with another task.",
      inputSchema: schema(["text"], { text: "The note." }),
      run: (a) => messageCaptain(deps, ctx, { text: str(a, "text") }),
    },
  };
}

const BY_ROLE: Readonly<Record<Role, (deps: Deps, ctx: AgentContext) => Record<string, Tool>>> = {
  coordinator: (deps, ctx) => ({
    ...coordinatorTools(deps, ctx),
    ...projectTools(deps, ctx),
    ...coordinatorNoteTools(deps, ctx),
  }),
  captain: (deps, ctx) => ({ ...captainTools(deps, ctx), ...captainNoteTools(deps, ctx) }),
  worker: (deps, ctx) => ({ ...workerTools(deps, ctx), ...workerGitTools(deps, ctx), ...workerNoteTools(deps, ctx) }),
};

/** Refuses any argument the tool's schema doesn't name (guide C7): a tool never takes settings it doesn't offer. */
function checkArgs(name: string, tool: Tool, args: Args): void {
  const props = tool.inputSchema.properties;
  const known = typeof props === "object" && props !== null ? Object.keys(props) : [];
  const extra = Object.keys(args).filter((k) => !known.includes(k));
  if (extra.length) {
    throw new BrigadeError(
      `${name} takes only ${known.join(", ") || "no arguments"}; it can't set ${extra.join(", ")}.`,
    );
  }
}

/**
 * The tools one agent may call: only its own role's. Each call runs on `fresh()`'s deps, a config snapshot read for
 * that call. Each `run` reports a bad argument as a rejected promise.
 */
export function toolsFor(
  deps: Deps,
  ctx: AgentContext,
  fresh: () => Promise<Deps> = () => Promise.resolve(deps),
): Record<string, Tool> {
  const tools = BY_ROLE[ctx.role](deps, ctx);
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        run: async (a: Args) => {
          checkArgs(name, t, a);
          const now = BY_ROLE[ctx.role](await fresh(), ctx)[name];
          if (!now) throw new BrigadeError(`No tool named "${name}".`);
          return now.run(a);
        },
      },
    ]),
  );
}
