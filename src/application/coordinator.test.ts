import { describe, expect, it } from "vitest";
import { listProjects, listTasks, sendToCaptain, startCoordinator } from "./coordinator.ts";
import { ctx, fakeDeps } from "./fakes.ts";

const coordinator = ctx({ role: "coordinator", terminal: "t9" });

describe("startCoordinator", () => {
  it("launches a Coordinator with no parent and no first message, and records it", async () => {
    const f = fakeDeps();
    const result = await startCoordinator(f.deps);
    expect(result).toEqual({ address: "t1", started: true });
    expect(f.terminals.launched).toEqual([
      {
        name: "bg-coordinator",
        cwd: "/state/coordinator",
        labels: { brigade: "main", role: "coordinator", harness: "claude" },
        parent: null,
        argv: ["claude", "bg-coordinator"],
      },
    ]);
    expect(f.harnesses.requests[0]?.firstMessage).toBeNull();
    expect(f.harnesses.requests[0]?.systemPrompt).toBe("coordinator prompt for Sam");
    expect(f.events.events).toEqual([
      {
        kind: "agent_started",
        role: "coordinator",
        project: null,
        terminal: "t1",
        spec: f.deps.config.roles.coordinator,
        at: "2026-11-08T10:00:00.000Z",
      },
    ]);
  });

  it("returns the running Coordinator instead of starting a second one", async () => {
    const f = fakeDeps();
    await startCoordinator(f.deps);
    expect(await startCoordinator(f.deps)).toEqual({ address: "t1", started: false });
    expect(f.terminals.launched).toHaveLength(1);
  });

  it("answers the trust prompt when the harness has one", async () => {
    const f = fakeDeps({ trust: { text: "trust", keys: ["enter"], ready: [] } });
    await startCoordinator(f.deps);
    expect(f.terminals.trustAnswered).toEqual(["t1"]);
  });
});

describe("sendToCaptain", () => {
  it("starts the project's Captain in its repo with the message as its first input", async () => {
    const f = fakeDeps();
    const reply = await sendToCaptain(f.deps, coordinator, { project: "shop", message: "Fix login" });
    expect(reply).toBe(
      "Sent to the shop Captain, which was started for it. End your turn; its report arrives as a [brigade] message.",
    );
    expect(f.terminals.launched[0]).toMatchObject({ name: "bg-cap-shop", cwd: "/repos/shop", parent: "t9" });
    expect(f.terminals.launched[0]?.labels).toEqual({
      brigade: "main",
      role: "captain",
      harness: "claude",
      project: "shop",
    });
    expect(f.harnesses.requests[0]?.firstMessage).toBe("[brigade] From the Coordinator: Fix login");
    expect(f.mcpContexts).toEqual([{ role: "captain", project: "shop", task: null, title: null, parent: "t9" }]);
    expect(f.terminals.sent).toEqual([]);
  });

  it("types into a running Captain instead of starting another", async () => {
    const f = fakeDeps();
    await sendToCaptain(f.deps, coordinator, { project: "shop", message: "one" });
    const reply = await sendToCaptain(f.deps, coordinator, { project: "shop", message: "two" });
    expect(reply).toBe("Sent to the shop Captain. End your turn; its report arrives as a [brigade] message.");
    expect(f.terminals.launched).toHaveLength(1);
    expect(f.terminals.sent).toEqual([{ address: "t1", text: "[brigade] From the Coordinator: two" }]);
  });

  it("names the known projects when the project is unknown", async () => {
    const f = fakeDeps();
    await expect(sendToCaptain(f.deps, coordinator, { project: "blog", message: "x" })).rejects.toThrow(
      'No project "blog". Projects: shop.',
    );
  });
});

describe("listProjects", () => {
  it("lists each project with its repo and base branch", () => {
    expect(listProjects(fakeDeps().deps)).toBe("shop: /repos/shop (base branch main)");
  });
});

describe("listTasks", () => {
  it("says so when there are no tasks", async () => {
    expect(await listTasks(fakeDeps().deps, null)).toBe("No tasks yet.");
    expect(await listTasks(fakeDeps().deps, "shop")).toBe("No tasks in shop yet.");
  });

  it("shows each task's state, terminal, live status and last note", async () => {
    const f = fakeDeps();
    const spec = f.deps.config.roles.worker;
    f.terminals.live.push({ address: "t5", name: "bg-task-1", labels: { brigade: "main" }, status: "done" });
    f.events.events.push(
      {
        at: "a",
        kind: "task_created",
        project: "shop",
        task: "task-1",
        title: "Login",
        branch: "b",
        worktree: "w",
        terminal: "t5",
        spec,
      },
      { at: "b", kind: "task_finished", task: "task-1", summary: "Fixed it" },
      {
        at: "c",
        kind: "task_created",
        project: "shop",
        task: "task-2",
        title: "Docs",
        branch: "b2",
        worktree: "w2",
        terminal: "t6",
        spec,
      },
    );
    expect(await listTasks(f.deps, "shop")).toBe(
      [
        'task-1 [shop] "Login" finished (terminal t5, done, codex): Fixed it',
        'task-2 [shop] "Docs" working (terminal t6, not running, codex)',
      ].join("\n"),
    );
  });
});
