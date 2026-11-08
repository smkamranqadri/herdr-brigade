import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessLaunchRequest } from "../../application/ports.ts";
import { HarnessAdapters } from "./harnesses.ts";

const request = (over: Partial<HarnessLaunchRequest> = {}): HarnessLaunchRequest => ({
  role: "worker",
  spec: { harness: "claude", model: "claude-sonnet-5-5", effort: "low", permissions: "ask" },
  agentId: "bg-task-1",
  systemPrompt: "You are a worker.",
  firstMessage: "Fix it.",
  mcp: { command: "/usr/bin/node", args: ["/b/cli.ts", "mcp"], env: { BRIGADE_ROLE: "worker" } },
  ...over,
});

describe("Claude harness", () => {
  it("builds the worker command and writes its prompt and MCP config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brigade-claude-"));
    const launch = await new HarnessAdapters(dir).prepare(request());
    const agentDir = path.join(dir, "bg-task-1");
    expect(launch.argv).toEqual([
      "claude",
      "--strict-mcp-config",
      "--mcp-config",
      path.join(agentDir, "mcp.json"),
      "--allowedTools",
      "mcp__brigade",
      "--permission-mode",
      "acceptEdits",
      "--append-system-prompt-file",
      path.join(agentDir, "system-prompt.md"),
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "low",
      "Fix it.",
    ]);
    expect(launch.trust).toEqual({
      text: "trust this folder",
      keys: ["down", "enter"],
      ready: ["? for shortcuts", "accept edits on", "manual mode on", "auto mode on", "bypass permissions on"],
    });
    expect(await readFile(path.join(agentDir, "system-prompt.md"), "utf8")).toBe("You are a worker.");
    expect(JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        brigade: {
          type: "stdio",
          command: "/usr/bin/node",
          args: ["/b/cli.ts", "mcp"],
          env: { BRIGADE_ROLE: "worker" },
        },
      },
    });
    expect((await stat(path.join(agentDir, "mcp.json"))).mode & 0o777).toBe(0o600);
  });

  it("keeps Coordinators and Captains from editing or running commands, and omits a missing first message", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brigade-claude-"));
    const launch = await new HarnessAdapters(dir).prepare(request({ role: "captain", firstMessage: null }));
    expect(launch.argv.slice(6, 10)).toEqual([
      "--disallowedTools",
      "Bash,Edit,Write,NotebookEdit",
      "--permission-mode",
      "manual",
    ]);
    expect(launch.argv.at(-1)).toBe("low");
  });

  it.each([
    ["worker", "ask", "acceptEdits"],
    ["worker", "auto", "auto"],
    ["worker", "bypass", "bypassPermissions"],
    ["coordinator", "ask", "manual"],
    ["coordinator", "auto", "auto"],
    ["captain", "bypass", "bypassPermissions"],
  ] as const)("runs a %s on %s with --permission-mode %s", async (role, permissions, mode) => {
    const dir = await mkdtemp(path.join(tmpdir(), "brigade-claude-"));
    const spec = { harness: "claude", model: "m", effort: "low", permissions } as const;
    const { argv } = await new HarnessAdapters(dir).prepare(request({ role, spec }));
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe(mode);
    expect(argv.includes("--disallowedTools")).toBe(role !== "worker");
  });

  it("refuses a harness that has no adapter yet", () => {
    const adapters = new HarnessAdapters("/tmp/unused");
    expect(() =>
      adapters.prepare(request({ spec: { harness: "pi", model: "m", effort: "low", permissions: "ask" } })),
    ).toThrow("The pi harness is not supported yet. Use claude.");
  });
});
