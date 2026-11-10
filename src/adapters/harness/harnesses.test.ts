import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessLaunch, HarnessLaunchRequest } from "../../application/ports.ts";
import type { AgentSpec, Harness, Role } from "../../domain/agent.ts";
import { tomlString } from "./codex.ts";
import { HarnessAdapters } from "./harnesses.ts";

const PI_EXTENSION = "/brigade/pi-extension/brigade.ts";
const MODEL: Readonly<Record<Harness, string>> = {
  claude: "claude-sonnet-5-5",
  codex: "gpt-6.1-terra",
  pi: "openai/gpt-6.1-sol",
};

const request = (harness: Harness, over: Partial<HarnessLaunchRequest> = {}): HarnessLaunchRequest => ({
  role: "worker",
  spec: { harness, model: MODEL[harness], effort: "low", permissions: "auto" },
  agentId: "bg-task-1",
  systemPrompt: 'You are a worker. Say "done" when done.',
  firstMessage: "- Fix the login bug.",
  mcp: {
    command: "/usr/bin/node",
    args: ["/b/cli.ts", "mcp"],
    env: { BRIGADE_ROLE: "worker", BRIGADE_TASK: "task-1" },
  },
  writableDirs: ["/repos/shop/.git"],
  ...over,
});

async function prepare(req: HarnessLaunchRequest): Promise<{ launch: HarnessLaunch; agentDir: string }> {
  const agentsDir = await mkdtemp(path.join(tmpdir(), "brigade-harness-"));
  const launch = await new HarnessAdapters({ agentsDir, piExtension: PI_EXTENSION }).prepare(req);
  return { launch, agentDir: path.join(agentsDir, req.agentId) };
}

/** Everything an agent receives: its argv and the files its argv names. */
function delivered(launch: HarnessLaunch): string {
  const files = launch.argv.filter((a) => a.startsWith("/") && existsSync(a) && a !== PI_EXTENSION);
  return [...launch.argv, ...files.map((f) => readFileSync(f, "utf8"))].join("\n");
}

/** How each harness keeps the Coordinator and Captains from changing anything. */
const READ_ONLY_MARK: Readonly<Record<Harness, string>> = {
  claude: "Bash,Edit,Write,NotebookEdit",
  codex: "read-only",
  pi: "bash,edit,write",
};

describe.each(["claude", "codex", "pi"] as const)("harness contract: %s", (harness) => {
  it("starts the harness's own program with the chosen model", async () => {
    const { launch } = await prepare(request(harness));
    expect(launch.argv[0]).toBe(harness);
    expect(launch.argv).toContain(MODEL[harness]);
  });

  it("delivers the system prompt and the MCP server's command, args and env", async () => {
    const req = request(harness);
    const text = delivered((await prepare(req)).launch);
    const tomlOrJson = (s: string) => text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1));
    expect(tomlOrJson(req.systemPrompt)).toBe(true);
    for (const v of [req.mcp.command, ...req.mcp.args, ...Object.values(req.mcp.env)]) expect(text).toContain(v);
  });

  it("delivers the first message exactly once: after -- at the end of argv, or typed in after start", async () => {
    const { argv, sendFirst } = (await prepare(request(harness))).launch;
    const inArgv = argv.slice(-2).join(" ") === "-- - Fix the login bug.";
    expect([inArgv, sendFirst === "- Fix the login bug."].filter(Boolean)).toHaveLength(1);
    const none = (await prepare(request(harness, { firstMessage: null }))).launch;
    expect(none.argv).not.toContain("--");
    expect(none.argv).not.toContain("- Fix the login bug.");
    expect(none.sendFirst).toBeNull();
  });

  it.each(["coordinator", "captain"] as const)(
    "keeps a %s from changing files or running commands",
    async (role: Role) => {
      expect(delivered((await prepare(request(harness, { role }))).launch)).toContain(READ_ONLY_MARK[harness]);
      expect(delivered((await prepare(request(harness))).launch)).not.toContain(READ_ONLY_MARK[harness]);
    },
  );

  it("describes its trust prompt fully, or has none", async () => {
    const { trust } = (await prepare(request(harness))).launch;
    if (trust === null) return;
    expect(trust.text).not.toBe("");
    expect(trust.cursor).not.toBe("");
    expect(trust.yes).not.toBe("");
    expect(trust.ready.length).toBeGreaterThan(0);
  });
});

describe("Claude Code", () => {
  it("builds the worker command and writes its private files", async () => {
    const { launch, agentDir } = await prepare(
      request("claude", { spec: { ...request("claude").spec, permissions: "ask" } }),
    );
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
      "--",
      "- Fix the login bug.",
    ]);
    expect(launch.trust).toEqual({
      text: "trust this folder",
      cursor: "❯",
      yes: "Yes, I trust this folder",
      ready: ["? for shortcuts", "accept edits on", "manual mode on", "auto mode on", "bypass permissions on"],
    });
    expect(JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        brigade: {
          type: "stdio",
          command: "/usr/bin/node",
          args: ["/b/cli.ts", "mcp"],
          env: request("claude").mcp.env,
        },
      },
    });
    expect((await stat(path.join(agentDir, "mcp.json"))).mode & 0o777).toBe(0o600);
  });

  it("loads the owner's own MCP servers for the Coordinator only; Captains and workers get brigade's alone", async () => {
    for (const [role, strict] of [
      ["coordinator", false],
      ["captain", true],
      ["worker", true],
    ] as const) {
      const { argv } = (await prepare(request("claude", { role }))).launch;
      expect([role, argv.includes("--strict-mcp-config")]).toEqual([role, strict]);
      expect(argv.slice(argv.indexOf("--allowedTools"), argv.indexOf("--allowedTools") + 2)).toEqual([
        "--allowedTools",
        "mcp__brigade",
      ]);
    }
  });

  it.each([
    ["worker", "ask", "acceptEdits"],
    ["worker", "auto", "auto"],
    ["worker", "bypass", "bypassPermissions"],
    ["coordinator", "ask", "manual"],
    ["coordinator", "auto", "auto"],
    ["captain", "bypass", "bypassPermissions"],
  ] as const)("runs a %s on %s with --permission-mode %s", async (role, permissions, mode) => {
    const spec: AgentSpec = { harness: "claude", model: "m", effort: "low", permissions };
    const { argv } = (await prepare(request("claude", { role, spec }))).launch;
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe(mode);
  });
});

describe("Codex", () => {
  it("builds the worker command with its sandbox, git folder, MCP settings and instructions", async () => {
    const { argv } = (await prepare(request("codex"))).launch;
    expect(argv).toEqual([
      "codex",
      "--no-daemon",
      "-m",
      "gpt-6.1-terra",
      "-c",
      'model_reasoning_effort="low"',
      "-a",
      "never",
      "-s",
      "workspace-write",
      "--add-dir",
      "/repos/shop/.git",
      "-c",
      'mcp_servers.brigade.command="/usr/bin/node"',
      "-c",
      'mcp_servers.brigade.args=["/b/cli.ts", "mcp"]',
      "-c",
      'mcp_servers.brigade.env={BRIGADE_ROLE = "worker", BRIGADE_TASK = "task-1"}',
      "-c",
      'mcp_servers.brigade.env_vars=["HC_TERMINAL_ID"]',
      "-c",
      'mcp_servers.brigade.default_tools_approval_mode="approve"',
      "-c",
      'developer_instructions="You are a worker. Say \\"done\\" when done."',
    ]);
  });

  it.each([
    ["worker", "ask", ["-a", "on-request", "-s", "workspace-write", "--add-dir", "/repos/shop/.git"]],
    ["worker", "bypass", ["--dangerously-bypass-approvals-and-sandbox"]],
    ["captain", "ask", ["-a", "on-request", "-s", "read-only"]],
    ["coordinator", "bypass", ["-a", "never", "-s", "read-only"]],
  ] as const)("runs a %s on %s with %j", async (role, permissions, flags) => {
    const spec: AgentSpec = { harness: "codex", model: "gpt-x", effort: "max", permissions };
    const { argv } = (await prepare(request("codex", { role, spec }))).launch;
    expect(argv.slice(6, 6 + flags.length)).toEqual(flags);
    expect(argv).toContain('model_reasoning_effort="xhigh"');
  });

  it("writes TOML strings with quotes, newlines and DEL escaped", () => {
    expect(tomlString('say "hi"\nnow\u007f')).toBe('"say \\"hi\\"\\nnow\\u007F"');
  });
});

describe("pi", () => {
  it("builds the command with brigade's extension and its MCP file, and ignores the repo's own pi files", async () => {
    const { launch, agentDir } = await prepare(request("pi", { role: "captain", firstMessage: null }));
    expect(launch.argv).toEqual([
      "pi",
      "--model",
      "openai/gpt-6.1-sol",
      "--thinking",
      "low",
      "--append-system-prompt",
      path.join(agentDir, "system-prompt.md"),
      "--no-approve",
      "-e",
      PI_EXTENSION,
      "--brigade-mcp",
      path.join(agentDir, "mcp.json"),
      "--exclude-tools",
      "bash,edit,write",
    ]);
    expect(launch.trust).toBeNull();
    expect(JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8"))).toEqual(request("pi").mcp);
  });
});
