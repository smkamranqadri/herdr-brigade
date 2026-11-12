import { describe, expect, it } from "vitest";
import { mcpEnv, readPaths } from "./settings.ts";

const env = { BRIGADE_HC: "/bin/hc", PATH: "" };
const context = { role: "worker", project: "shop", task: "task-1", title: "T", parent: "t2" } as const;

describe("the brigade instance", () => {
  it("is main unless BRIGADE_INSTANCE sets another, and agents' MCP servers get it", () => {
    expect(readPaths(env).instance).toBe("main");
    const paths = readPaths({ ...env, BRIGADE_INSTANCE: "e2e-1" });
    expect(paths.instance).toBe("e2e-1");
    expect(mcpEnv(context, paths).BRIGADE_INSTANCE).toBe("e2e-1");
  });

  it("refuses a name that is not 1-32 of a-z, 0-9 and -", () => {
    for (const bad of ["", "Main", "a b", "x".repeat(33)])
      expect(() => readPaths({ ...env, BRIGADE_INSTANCE: bad })).toThrow(
        `BRIGADE_INSTANCE must be 1-32 of a-z, 0-9 and -, not "${bad}"`,
      );
  });
});
