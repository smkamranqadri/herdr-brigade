import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ctx, fakeDeps } from "../../application/fakes.ts";
import { handleMessage, serve, type Tool } from "./protocol.ts";
import { toolsFor } from "./tools.ts";

const echo: Record<string, Tool> = {
  echo: { description: "Echo", inputSchema: { type: "object" }, run: (a) => Promise.resolve(`got ${String(a.x)}`) },
  boom: {
    description: "Fails",
    inputSchema: { type: "object" },
    run: () => Promise.reject(new Error("disk full")),
  },
};
const noErrors = () => undefined;

describe("handleMessage", () => {
  it("answers initialize with the client's protocol version and the tools capability", async () => {
    expect(
      await handleMessage(echo, { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, noErrors),
    ).toEqual({
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "brigade", version: "0.1.0" },
      },
    });
  });

  it("lists tools and calls one", async () => {
    expect(await handleMessage(echo, { id: 2, method: "tools/list" }, noErrors)).toEqual({
      result: {
        tools: [
          { name: "echo", description: "Echo", inputSchema: { type: "object" } },
          { name: "boom", description: "Fails", inputSchema: { type: "object" } },
        ],
      },
    });
    expect(
      await handleMessage(
        echo,
        { id: 3, method: "tools/call", params: { name: "echo", arguments: { x: 5 } } },
        noErrors,
      ),
    ).toEqual({
      result: { content: [{ type: "text", text: "got 5" }] },
    });
  });

  it("turns a failure into a tool error and reports it", async () => {
    const seen: unknown[] = [];
    expect(
      await handleMessage(echo, { id: 4, method: "tools/call", params: { name: "boom" } }, (e) => seen.push(e)),
    ).toEqual({
      result: { content: [{ type: "text", text: "Brigade failed: disk full" }], isError: true },
    });
    expect(seen).toHaveLength(1);
  });

  it("rejects unknown tools and methods, and ignores notifications", async () => {
    expect(await handleMessage(echo, { id: 5, method: "tools/call", params: { name: "nope" } }, noErrors)).toEqual({
      result: { content: [{ type: "text", text: 'No tool named "nope".' }], isError: true },
    });
    expect(await handleMessage(echo, { id: 6, method: "resources/list" }, noErrors)).toEqual({
      error: { code: -32601, message: "Method not found: resources/list" },
    });
    expect(await handleMessage(echo, { method: "notifications/initialized" }, noErrors)).toBeNull();
  });
});

describe("serve", () => {
  it("answers each line on the output stream and reports bad JSON", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = serve(echo, input, output, noErrors);
    input.end('{"jsonrpc":"2.0","id":1,"method":"ping"}\nnot json\n');
    await done;
    await new Promise((r) => setImmediate(r));
    const lines = String(output.read())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as unknown);
    expect(lines).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
  });
});

describe("toolsFor", () => {
  it("gives each role only its own tools", () => {
    const { deps } = fakeDeps();
    expect(Object.keys(toolsFor(deps, ctx({ role: "coordinator" })))).toEqual([
      "list_projects",
      "send_to_captain",
      "list_tasks",
    ]);
    expect(Object.keys(toolsFor(deps, ctx({ role: "captain", project: "shop" })))).toEqual([
      "create_task",
      "send_to_task",
      "list_tasks",
      "report",
    ]);
    expect(Object.keys(toolsFor(deps, ctx({ role: "worker" })))).toEqual(["finish", "ask_user", "message_captain"]);
  });

  it("validates arguments before calling a use case", async () => {
    const f = fakeDeps();
    const tools = toolsFor(f.deps, ctx({ role: "captain", project: "shop" }));
    await expect(tools.create_task?.run({ title: "", prompt: "p" })).rejects.toThrow(
      '"title" is required and must be text.',
    );
    await expect(tools.create_task?.run({ title: "t", prompt: "x".repeat(20_001) })).rejects.toThrow(
      '"prompt" is longer than 20000 characters.',
    );
    expect(f.terminals.launched).toEqual([]);
  });

  it("passes optional create_task choices through", async () => {
    const f = fakeDeps();
    const tools = toolsFor(f.deps, ctx({ role: "captain", project: "shop", terminal: "t3" }));
    await tools.create_task?.run({ title: "t", prompt: "p", harness: "claude", model: "sonnet", effort: "low" });
    expect(f.harnesses.requests[0]?.spec).toEqual({
      harness: "claude",
      model: "sonnet",
      effort: "low",
      permissions: "auto",
    });
  });
});
