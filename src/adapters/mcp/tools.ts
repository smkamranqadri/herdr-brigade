import { createTask, reportToCoordinator, sendToTask } from "../../application/captain.ts";
import { listProjects, listTasks, sendToCaptain } from "../../application/coordinator.ts";
import type { Deps } from "../../application/ports.ts";
import { askOwner, finishTask, messageCaptain } from "../../application/worker.ts";
import type { AgentContext, Role } from "../../domain/agent.ts";
import { BrigadeError } from "../../domain/errors.ts";
import type { Tool } from "./protocol.ts";

type Args = Readonly<Record<string, unknown>>;

const MAX_TEXT = 20_000;

/** Validates one string argument at the border (guide C7). */
function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") throw new BrigadeError(`"${key}" is required and must be text.`);
  if (v.length > MAX_TEXT) throw new BrigadeError(`"${key}" is longer than ${MAX_TEXT} characters.`);
  return v;
}

function optStr(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : str(args, key);
}

const schema = (required: readonly string[], props: Readonly<Record<string, string>>) => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])),
  required,
});

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
  coordinator: coordinatorTools,
  captain: captainTools,
  worker: workerTools,
};

/** The tools one agent may call: only its own role's. Each `run` reports a bad argument as a rejected promise. */
export function toolsFor(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  const tools = BY_ROLE[ctx.role](deps, ctx);
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [name, { ...t, run: async (a: Args) => t.run(a) }]),
  );
}
