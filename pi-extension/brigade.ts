// Registers brigade's MCP server for one pi session. brigade starts pi with `-e <this file> --brigade-mcp <file>`,
// where the file holds the server's command, args and env (written by src/adapters/harness/pi.ts).
import { readFileSync } from "node:fs";

/** The part of pi's extension API this file uses. */
interface PiApi {
  registerFlag(name: string, options: { description: string; type: "string"; default: string }): void;
  getFlag(name: string): unknown;
  registerMcpServer(name: string, config: Record<string, unknown>): void;
  on(event: "session_start", handler: () => void): void;
}

interface McpFile {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const FLAG = "brigade-mcp";

function readMcpFile(file: string): McpFile {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error(`${file} is not a brigade MCP file`);
  const fields = new Map<string, unknown>(Object.entries(raw));
  const command = fields.get("command");
  const args = fields.get("args");
  const env = fields.get("env");
  const argsOk = Array.isArray(args) && args.every((a) => typeof a === "string");
  if (typeof command !== "string" || !argsOk || typeof env !== "object" || env === null) {
    throw new Error(`${file} needs command, args and env`);
  }
  return {
    command,
    args: args.map(String),
    env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])),
  };
}

export default function brigade(pi: PiApi): void {
  pi.registerFlag(FLAG, { description: "Brigade's MCP server file (set by brigade)", type: "string", default: "" });
  // Flag values arrive after loading; a server registered then connects at once.
  pi.on("session_start", () => {
    const file = pi.getFlag(FLAG);
    if (typeof file !== "string" || file === "") return;
    const mcp = readMcpFile(file);
    // The server reports from this agent's own terminal, which only the agent's env knows.
    const terminal = process.env.HC_TERMINAL_ID;
    const env = terminal ? { ...mcp.env, HC_TERMINAL_ID: terminal } : mcp.env;
    pi.registerMcpServer("brigade", {
      command: mcp.command,
      args: mcp.args,
      env,
      exposure: "direct",
      description: "Brigade: talk to your Coordinator, Captain or workers.",
    });
  });
}
