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
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

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
  serverInfo: { name: "brigade", version: "1.0.0" },
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

const isId = (v: unknown) => v === undefined || typeof v === "string" || typeof v === "number";
const isParams = (v: unknown) => v === undefined || (typeof v === "object" && v !== null);

/** A JSON-RPC request or notification: an object with a method name and, for a request, a string or number id. */
function isRequest(value: unknown): value is Request {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  return isId(fields.get("id")) && typeof fields.get("method") === "string" && isParams(fields.get("params"));
}

type Write = (id: unknown, reply: NonNullable<Reply>) => void;

/** Parses one line into a request, or answers it with the right JSON-RPC error and returns null. */
function parseLine(line: string, write: Write, onError: (err: unknown) => void): Request | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    onError(err);
    write(null, { error: { code: PARSE_ERROR, message: "Parse error" } });
    return null;
  }
  if (isRequest(parsed)) return parsed;
  onError(new Error(`Invalid JSON-RPC request: ${line.slice(0, 120)}`));
  write(null, { error: { code: INVALID_REQUEST, message: "Invalid Request" } });
  return null;
}

/** Serves `tools` on a line stream until it closes. A failing request never stops the server. */
export function serve(
  tools: Readonly<Record<string, Tool>>,
  input: Readable,
  output: Writable,
  onError: (err: unknown) => void,
): Promise<void> {
  const write: Write = (id, reply) => output.write(JSON.stringify({ jsonrpc: "2.0", id, ...reply }) + "\n");
  const lines = createInterface({ input });
  lines.on("line", (line) => {
    const req = line.trim() ? parseLine(line, write, onError) : null;
    if (!req) return;
    handleMessage(tools, req, onError).then(
      (reply) => {
        if (reply) write(req.id, reply);
      },
      (err: unknown) => {
        onError(err);
        if (req.id !== undefined) write(req.id, { error: { code: INTERNAL_ERROR, message: "Internal error" } });
      },
    );
  });
  return new Promise((resolve) => lines.on("close", resolve));
}
