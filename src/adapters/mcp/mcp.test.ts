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
        serverInfo: { name: "brigade", version: "1.2.0" },
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
      .map((l): unknown => JSON.parse(l));
    expect(lines).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
  });
});

describe("serve with bad input", () => {
  it("answers a non-request with Invalid Request and an internal failure with Internal error, then keeps serving", async () => {
    const broken: Record<string, Tool> = {
      odd: {
        get description(): string {
          throw new Error("broken tool table");
        },
        inputSchema: {},
        run: () => Promise.resolve(""),
      },
    };
    const input = new PassThrough();
    const output = new PassThrough();
    const seen: unknown[] = [];
    const done = serve(broken, input, output, (e) => seen.push(e));
    input.end('null\n[1]\n{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n{"jsonrpc":"2.0","id":8,"method":"ping"}\n');
    await done;
    await new Promise((r) => setImmediate(r));
    const lines = String(output.read())
      .trim()
      .split("\n")
      .map((l): unknown => JSON.parse(l));
    // JSON-RPC replies may arrive in any order: check the exact set.
    expect(lines).toHaveLength(4);
    expect(lines).toEqual(
      expect.arrayContaining([
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
        { jsonrpc: "2.0", id: 8, result: {} },
        { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Internal error" } },
      ]),
    );
    expect(lines.filter((l) => JSON.stringify(l).includes("-32600"))).toHaveLength(2);
    expect(seen).toHaveLength(3);
  });
});

describe("toolsFor", () => {
  it("gives each role only its own tools", () => {
    const { deps } = fakeDeps();
    expect(Object.keys(toolsFor(deps, ctx({ role: "coordinator" })))).toEqual([
      "list_projects",
      "send_to_captain",
      "list_tasks",
      "find_repo",
      "add_project",
      "update_project",
      "save_note",
      "repo_status",
      "herdr_agents",
    ]);
    expect(Object.keys(toolsFor(deps, ctx({ role: "captain", project: "shop" })))).toEqual([
      "create_task",
      "send_to_task",
      "list_tasks",
      "report",
      "list_notes",
      "add_note",
      "change_note",
      "remove_note",
      "list_suggestions",
      "resolve_suggestion",
      "repo_status",
    ]);
    expect(Object.keys(toolsFor(deps, ctx({ role: "worker" })))).toEqual([
      "finish",
      "ask_user",
      "message_captain",
      "commit",
      "create_pull_request",
      "suggest_note",
      "read_notes",
    ]);
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

  it("refuses an argument the tool doesn't offer, so update_project can't touch the GitHub repo", async () => {
    const f = fakeDeps();
    const tools = toolsFor(f.deps, ctx({ role: "coordinator" }));
    await expect(tools.update_project?.run({ name: "shop", baseBranch: "main", github: "evil/repo" })).rejects.toThrow(
      "update_project takes only name, baseBranch; it can't set github.",
    );
    expect(f.configStore.writes).toBe(0);
  });

  it("lets neither project tool set the owner, the roles or the repo roots", async () => {
    const f = fakeDeps();
    const tools = toolsFor(f.deps, ctx({ role: "coordinator" }));
    for (const field of ["owner", "roles", "repoRoots"]) {
      await expect(tools.update_project?.run({ name: "shop", baseBranch: "main", [field]: "x" })).rejects.toThrow(
        `update_project takes only name, baseBranch; it can't set ${field}.`,
      );
      await expect(tools.add_project?.run({ name: "blog", repo: "/repos/blog", [field]: "x" })).rejects.toThrow(
        `add_project takes only name, repo, baseBranch; it can't set ${field}.`,
      );
    }
    expect(f.configStore.writes).toBe(0);
  });

  it("runs each call on a fresh config snapshot", async () => {
    const f = fakeDeps();
    const added = {
      ...f.deps.config,
      projects: [...f.deps.config.projects, { name: "blog", repo: "/repos/blog", baseBranch: "main", github: null }],
    };
    const tools = toolsFor(f.deps, ctx({ role: "coordinator" }), () => Promise.resolve({ ...f.deps, config: added }));
    expect(await tools.list_projects?.run({})).toBe(
      "shop: /repos/shop (base branch main)\nblog: /repos/blog (base branch main)",
    );
  });

  it("refuses an outcome other than accept, merge or reject", async () => {
    const tools = toolsFor(fakeDeps().deps, ctx({ role: "captain", project: "shop" }));
    await expect(tools.resolve_suggestion?.run({ suggestion: "s", outcome: "maybe", reason: "r" })).rejects.toThrow(
      '"outcome" must be accept, merge or reject.',
    );
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
