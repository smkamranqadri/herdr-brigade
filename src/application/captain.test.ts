import { describe, expect, it } from "vitest";
import { createTask, reportToCoordinator, sendToTask, workerSpec } from "./captain.ts";
import { ctx, fakeDeps } from "./fakes.ts";

const captain = ctx({ role: "captain", terminal: "t3", project: "shop" });

describe("createTask", () => {
  it("makes a branch and worktree, starts the worker there under the Captain, and records the task", async () => {
    const f = fakeDeps();
    const reply = await createTask(f.deps, captain, { title: "Fix the login bug", prompt: "Fix it." });
    expect(f.worktrees.created).toEqual([
      { repo: "/repos/shop", baseBranch: "main", branch: "brigade/fix-the-login-bug-000001" },
    ]);
    expect(f.terminals.launched[0]).toEqual({
      name: "bg-task-000001",
      cwd: "/worktrees/brigade/fix-the-login-bug-000001",
      labels: {
        brigade: "main",
        role: "worker",
        harness: "codex",
        project: "shop",
        task: "task-000001",
        title: "Fix the login bug",
      },
      parent: "t3",
      argv: ["codex", "bg-task-000001"],
    });
    expect(f.harnesses.requests[0]?.firstMessage).toBe("Fix it.");
    expect(f.mcpContexts).toEqual([
      { role: "worker", project: "shop", task: "task-000001", title: "Fix the login bug", parent: "t3" },
    ]);
    expect(f.events.events[0]).toMatchObject({
      kind: "task_created",
      task: "task-000001",
      terminal: "t1",
      worktree: "/worktrees/brigade/fix-the-login-bug-000001",
    });
    expect(reply).toBe(
      'Started task-000001 "Fix the login bug" on codex (gpt-x) in terminal t1, branch brigade/fix-the-login-bug-000001. End your turn; its report arrives as a [brigade] message.',
    );
  });

  it("refuses an agent with no project", async () => {
    const f = fakeDeps();
    await expect(createTask(f.deps, ctx({ role: "worker" }), { title: "x", prompt: "y" })).rejects.toThrow(
      "Only a Captain can do this: this agent has no project.",
    );
    expect(f.terminals.launched).toEqual([]);
  });
});

describe("workerSpec", () => {
  const base = { harness: "codex", model: "gpt-x", effort: "medium" } as const;

  it("uses the config's spec when nothing is chosen", () => {
    expect(workerSpec(base, { title: "t", prompt: "p" })).toEqual(base);
  });

  it("takes a new harness only with its own model", () => {
    expect(workerSpec(base, { title: "t", prompt: "p", harness: "pi", model: "openai/x", effort: "low" })).toEqual({
      harness: "pi",
      model: "openai/x",
      effort: "low",
    });
    expect(() => workerSpec(base, { title: "t", prompt: "p", harness: "pi" })).toThrow(
      'Give a model for pi: the default model "gpt-x" is for codex.',
    );
  });

  it("rejects an unknown harness or effort", () => {
    expect(() => workerSpec(base, { title: "t", prompt: "p", harness: "cursor" })).toThrow('Unknown harness "cursor"');
    expect(() => workerSpec(base, { title: "t", prompt: "p", effort: "huge" })).toThrow('Unknown effort "huge"');
  });
});

describe("sendToTask", () => {
  it("types a follow-up into the task's running worker", async () => {
    const f = fakeDeps();
    await createTask(f.deps, captain, { title: "Login", prompt: "p" });
    expect(await sendToTask(f.deps, captain, { task: "task-000001", message: "Also add a test" })).toBe(
      "Sent to task-000001. End your turn; its report arrives as a [brigade] message.",
    );
    expect(f.terminals.sent).toEqual([{ address: "t1", text: "[brigade] From your Captain: Also add a test" }]);
  });

  it("refuses a task from another project", async () => {
    const f = fakeDeps();
    await createTask(f.deps, captain, { title: "Login", prompt: "p" });
    const other = ctx({ role: "captain", terminal: "t8", project: "blog" });
    await expect(sendToTask(f.deps, other, { task: "task-000001", message: "x" })).rejects.toThrow(
      "No task task-000001 in blog. Call list_tasks.",
    );
  });

  it("says so when the worker is no longer running", async () => {
    const f = fakeDeps();
    await createTask(f.deps, captain, { title: "Login", prompt: "p" });
    f.terminals.live.length = 0;
    await expect(sendToTask(f.deps, captain, { task: "task-000001", message: "x" })).rejects.toThrow(
      "The worker for task-000001 is not running",
    );
  });
});

describe("reportToCoordinator", () => {
  it("types the report into the Coordinator, naming the project", async () => {
    const f = fakeDeps();
    f.terminals.live.push({
      address: "t9",
      name: "bg-coordinator",
      labels: { brigade: "main", role: "coordinator" },
      status: "idle",
    });
    expect(await reportToCoordinator(f.deps, captain, { text: "PR is ready" })).toBe("Sent to the Coordinator.");
    expect(f.terminals.sent).toEqual([{ address: "t9", text: "[brigade] Captain for shop: PR is ready" }]);
  });

  it("says so when no Coordinator is running", async () => {
    await expect(reportToCoordinator(fakeDeps().deps, captain, { text: "x" })).rejects.toThrow(
      "The Coordinator is not running.",
    );
  });
});
