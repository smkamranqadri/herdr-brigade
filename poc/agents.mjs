// Builds the files and argv that start a Captain or a worker as an interactive Claude Code terminal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_DIR = path.join(HERE, ".state");
export const EVENTS_FILE = path.join(STATE_DIR, "events.jsonl");
export const BRIGADE_LABEL = "poc";
export const MODEL = process.env.BRIGADE_MODEL || "claude-sonnet-5-5";
export const EFFORT = process.env.BRIGADE_EFFORT || "low";

const ROLE_FLAGS = {
  captain: ["--disallowedTools", "Bash,Edit,Write,NotebookEdit", "--permission-mode", "default"],
  worker: ["--permission-mode", "acceptEdits"],
};

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`prompt placeholder {{${key}}} has no value`);
    return values[key];
  });
}

/** Writes the agent's MCP config and system prompt, and returns the claude argv. */
export function agentArgv({ role, id, values, env, firstMessage }) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const promptFile = path.join(STATE_DIR, `${id}.prompt.md`);
  fs.writeFileSync(promptFile, fill(fs.readFileSync(path.join(HERE, "prompts", `${role}.md`), "utf8"), values));
  const mcpFile = path.join(STATE_DIR, `${id}.mcp.json`);
  const server = { type: "stdio", command: process.execPath, args: [path.join(HERE, "mcp.mjs")], env: { BRIGADE_ROLE: role, ...env } };
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { brigade: server } }, null, 2));
  // --mcp-config and --allowedTools take several values, so a single-value flag must come
  // between them and the first message, or the message is read as one more value.
  return [
    "claude",
    "--strict-mcp-config",
    "--mcp-config", mcpFile,
    "--allowedTools", "mcp__brigade",
    ...ROLE_FLAGS[role],
    "--append-system-prompt-file", promptFile,
    "--model", MODEL,
    "--effort", EFFORT,
    firstMessage,
  ];
}

export function recordEvent(event) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(EVENTS_FILE, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

export function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
