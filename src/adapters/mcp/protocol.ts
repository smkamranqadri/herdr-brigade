// A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with the tools capability only.
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { BrigadeError } from "../../domain/errors.ts";

export interface Tool {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  run(args: Readonly<Record<string, unknown>>): Promise<string>;
}

const PROTOCOL_FALLBACK = "2025-06-18";
const METHOD_NOT_FOUND = -32601;
const PARSE_ERROR = -32700;

interface Request {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: {
    readonly protocolVersion?: string;
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
}

type Reply = { result: unknown } | { error: { code: number; message: string } } | null;

const text = (body: string, isError = false) => ({
  content: [{ type: "text", text: body }],
  ...(isError ? { isError } : {}),
});

async function callTool(
  tools: Readonly<Record<string, Tool>>,
  req: Request,
  onError: (err: unknown) => void,
): Promise<Reply> {
  const name = req.params?.name ?? "";
  const tool = tools[name];
  if (!tool) return { result: text(`No tool named "${name}".`, true) };
  try {
    return { result: text(await tool.run(req.params?.arguments ?? {})) };
  } catch (err) {
    onError(err);
    // A BrigadeError is meant for the agent. Anything else is a bug: say so without internals.
    const message =
      err instanceof BrigadeError ? err.message : `Brigade failed: ${err instanceof Error ? err.message : String(err)}`;
    return { result: text(message, true) };
  }
}

const initializeResult = (req: Request) => ({
  protocolVersion: req.params?.protocolVersion ?? PROTOCOL_FALLBACK,
  capabilities: { tools: {} },
  serverInfo: { name: "brigade", version: "0.1.0" },
});

/** Answers one JSON-RPC message. Notifications (no id) get no reply. */
export async function handleMessage(
  tools: Readonly<Record<string, Tool>>,
  req: Request,
  onError: (err: unknown) => void,
): Promise<Reply> {
  if (req.id === undefined) return null;
  switch (req.method) {
    case "initialize":
      return { result: initializeResult(req) };
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    case "tools/call":
      return callTool(tools, req, onError);
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${String(req.method)}` } };
  }
}

/** Serves `tools` on a line stream until it closes. */
export function serve(
  tools: Readonly<Record<string, Tool>>,
  input: Readable,
  output: Writable,
  onError: (err: unknown) => void,
): Promise<void> {
  const write = (id: unknown, reply: NonNullable<Reply>) =>
    output.write(JSON.stringify({ jsonrpc: "2.0", id, ...reply }) + "\n");
  const lines = createInterface({ input });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch (err) {
      onError(err);
      write(null, { error: { code: PARSE_ERROR, message: "Parse error" } });
      return;
    }
    void handleMessage(tools, req, onError).then((reply) => {
      if (reply) write(req.id, reply);
    });
  });
  return new Promise((resolve) => lines.on("close", resolve));
}
