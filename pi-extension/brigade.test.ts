import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import brigade from "./brigade.ts";

function fakePi(flagValue: string) {
  const registered: { name: string; config: Record<string, unknown> }[] = [];
  const handlers: (() => void)[] = [];
  const api = {
    registerFlag: vi.fn(),
    getFlag: () => flagValue,
    registerMcpServer: (name: string, config: Record<string, unknown>) => registered.push({ name, config }),
    on: (_event: "session_start", handler: () => void) => handlers.push(handler),
  };
  brigade(api);
  return {
    api,
    registered,
    start: () => {
      for (const h of handlers) h();
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("pi extension", () => {
  it("registers brigade's server from the --brigade-mcp file, adding the agent's terminal", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "brigade-pi-")), "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ command: "/usr/bin/node", args: ["/b/cli.ts", "mcp"], env: { BRIGADE_ROLE: "worker" } }),
    );
    vi.stubEnv("HC_TERMINAL_ID", "t42");
    const pi = fakePi(file);
    expect(pi.api.registerFlag).toHaveBeenCalledWith("brigade-mcp", {
      description: "Brigade's MCP server file (set by brigade)",
      type: "string",
      default: "",
    });
    expect(pi.registered).toEqual([]);
    pi.start();
    expect(pi.registered).toEqual([
      {
        name: "brigade",
        config: {
          command: "/usr/bin/node",
          args: ["/b/cli.ts", "mcp"],
          env: { BRIGADE_ROLE: "worker", HC_TERMINAL_ID: "t42" },
          exposure: "direct",
          description: "Brigade: talk to your Coordinator, Captain or workers.",
        },
      },
    ]);
  });

  it("does nothing in a pi session brigade didn't start", () => {
    const pi = fakePi("");
    pi.start();
    expect(pi.registered).toEqual([]);
  });

  it("fails loudly on a file without command, args and env", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "brigade-pi-")), "mcp.json");
    await writeFile(file, JSON.stringify({ command: "/usr/bin/node" }));
    const pi = fakePi(file);
    expect(() => {
      pi.start();
    }).toThrow(`${file} needs command, args and env`);
  });
});
