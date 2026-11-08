// Brigade's MCP server over stdio (newline-delimited JSON-RPC 2.0). Claude Code starts one per agent.
// The role (captain or worker) and the task come from the env its MCP config sets.
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import { agentArgv, BRIGADE_LABEL, readEvents, recordEvent } from "./agents.mjs";
import { answerTrustPrompt, hc, launch } from "./hc.mjs";

const env = process.env;
const ROLE = env.BRIGADE_ROLE;
const SELF = env.HC_TERMINAL_ID || null;
const PROTOCOL_FALLBACK = "2025-06-18";
const ERR_METHOD = -32601;

const base = { role: ROLE, project: env.BRIGADE_PROJECT, task: env.BRIGADE_TASK, terminal: SELF };

const TOOLS = {
  captain: {
    create_task: {
      description: "Start one worker agent in its own Herdr terminal for a new piece of work in this project. Returns at once; the worker reports back to you as a [brigade] message.",
      inputSchema: { type: "object", properties: { title: { type: "string" }, prompt: { type: "string", description: "Self-contained brief: the goal, limits and what done means." } }, required: ["title", "prompt"] },
      run: createTask,
    },
    list_tasks: {
      description: "The tasks this Captain started, with the last event of each.",
      inputSchema: { type: "object", properties: {} },
      run: listTasks,
    },
  },
  worker: {
    finish: {
      description: "Call when the task is complete. Sends your summary to the Captain. Then end your turn.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      run: ({ summary }) => report("finished", `finished: ${summary}`, { summary }),
    },
    ask_user: {
      description: "Ask the owner a question when you need a decision. Then end your turn.",
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      run: ({ question }) => report("asked", `asks: ${question}`, { question }),
    },
  },
};

function createTask({ title, prompt }) {
  if (!SELF) throw new Error("HC_TERMINAL_ID is not set, so the worker has no parent to report to");
  const id = `w-${randomBytes(3).toString("hex")}`;
  const argv = agentArgv({
    role: "worker",
    id,
    values: { TASK: id, TITLE: title, PROJECT: env.BRIGADE_PROJECT },
    env: { BRIGADE_PROJECT: env.BRIGADE_PROJECT, BRIGADE_TASK: id, BRIGADE_TITLE: title, BRIGADE_PARENT: SELF, BRIGADE_HC: env.BRIGADE_HC ?? "hc" },
    firstMessage: prompt,
  });
  const address = launch({
    name: `brigade-${id}`,
    cwd: env.BRIGADE_REPO,
    labels: { brigade: BRIGADE_LABEL, project: env.BRIGADE_PROJECT, task: id, role: "worker", title },
    parent: SELF,
    notify: true,
    argv,
  });
  const trusted = answerTrustPrompt(address);
  recordEvent({ ...base, kind: "task_created", data: { id, title, address, trustPromptAnswered: trusted } });
  return `Started task ${id} ("${title}") in terminal ${address}. End your turn; its report arrives as a [brigade] message.`;
}

function listTasks() {
  const tasks = new Map();
  for (const e of readEvents()) {
    if (e.kind === "task_created") tasks.set(e.data.id, { title: e.data.title, last: "created", at: e.at });
    else if (e.role === "worker" && tasks.has(e.task)) Object.assign(tasks.get(e.task), { last: e.kind, at: e.at });
  }
  if (!tasks.size) return "No tasks yet.";
  return [...tasks.entries()].map(([id, t]) => `${id} "${t.title}": ${t.last} at ${t.at}`).join("\n");
}

function report(kind, text, data) {
  recordEvent({ ...base, kind, data });
  const parent = env.BRIGADE_PARENT;
  hc(["send", parent, `[brigade] Task ${env.BRIGADE_TASK} "${env.BRIGADE_TITLE}" ${text}`]);
  return "Sent to your Captain. End your turn now.";
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function handle(msg) {
  const tools = TOOLS[ROLE] ?? {};
  switch (msg.method) {
    case "initialize":
      return respond(msg.id, { protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_FALLBACK, capabilities: { tools: {} }, serverInfo: { name: "brigade", version: "0.0.1-poc" } });
    case "ping":
      return respond(msg.id, {});
    case "tools/list":
      return respond(msg.id, { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const tool = tools[msg.params?.name];
      if (!tool) return respond(msg.id, { content: [{ type: "text", text: `No tool ${msg.params?.name}` }], isError: true });
      try {
        return respond(msg.id, { content: [{ type: "text", text: tool.run(msg.params.arguments ?? {}) }] });
      } catch (err) {
        recordEvent({ ...base, kind: "tool_error", data: { tool: msg.params.name, message: String(err.message ?? err) } });
        return respond(msg.id, { content: [{ type: "text", text: `Error: ${err.message ?? err}` }], isError: true });
      }
    }
    default:
      if (msg.id !== undefined) respondError(msg.id, ERR_METHOD, `Method not found: ${msg.method}`);
  }
}

recordEvent({ ...base, kind: "mcp_start", data: { hcTerminalFromEnv: SELF } });
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    recordEvent({ ...base, kind: "bad_message", data: { message: String(err.message) } });
    return;
  }
  handle(msg);
});
