import { describe, expect, it } from "vitest";
import type { BrigadeConfig } from "../domain/config.ts";
import { createTask } from "./captain.ts";
import { ctx, fakeDeps } from "./fakes.ts";
import { taskNamed, workerFor } from "./resume.ts";

const captain = ctx({ role: "captain", terminal: "t9", project: "shop" });
const TRUST = { text: "trust", cursor: ">", yes: "Yes", ready: [] };

/** The shop task task-000001 whose worker (t1) has ended, with the shop Captain running in t9. */
async function ended(options: { trust?: typeof TRUST } = {}) {
  const f = fakeDeps(options);
  await createTask(f.deps, captain, { title: "Login", prompt: "Add a login page" });
  f.terminals.live.length = 0;
  f.terminals.live.push({
    address: "t9",
    name: "bg-cap-shop",
    labels: { brigade: "main", role: "captain", project: "shop" },
    status: null,
  });
  const task = await taskNamed(f.deps, "task-000001");
  if (!task) throw new Error("no task");
  return { ...f, task };
}

describe("workerFor", () => {
  it("gives a running worker as it is, without a resume", async () => {
    const f = fakeDeps();
    await createTask(f.deps, captain, { title: "Login", prompt: "p" });
    const task = await taskNamed(f.deps, "task-000001");
    if (!task) throw new Error("no task");
    expect(await workerFor(f.deps, task)).toEqual({ address: "t1", resumed: false });
    expect(f.terminals.launched).toHaveLength(1);
    expect(f.locks.taken).toEqual(["task-000001"]);
  });

  it("resumes an ended worker with the task's own spec, repo and worktree, under the running Captain", async () => {
    const f = await ended();
    const changed: BrigadeConfig = {
      ...f.deps.config,
      roles: {
        ...f.deps.config.roles,
        worker: { harness: "pi", model: "other", effort: "max", permissions: "bypass" },
      },
      projects: [{ name: "shop", repo: "/elsewhere/shop", baseBranch: "main", github: "acme/shop" }],
    };
    const deps = { ...f.deps, config: changed };
    expect(await workerFor(deps, f.task)).toEqual({ address: "t2", resumed: true });
    expect(f.worktrees.verified).toEqual([
      {
        worktree: "/worktrees/brigade/login-000001",
        repo: "/repos/shop",
        branch: "brigade/login-000001",
        runHooks: false,
      },
    ]);
    expect(f.harnesses.requests[1]).toMatchObject({
      role: "worker",
      spec: f.task.spec,
      firstMessage: null,
      writableDirs: ["/repos/shop/.git"],
      readDirs: [],
      resume: true,
    });
    expect(f.terminals.launched[1]).toMatchObject({
      name: "bg-task-000001",
      cwd: "/worktrees/brigade/login-000001",
      parent: "t9",
      outliveParent: true,
      labels: { brigade: "main", role: "worker", project: "shop", task: "task-000001", title: "Login" },
    });
    expect(f.events.events.at(-1)).toMatchObject({
      kind: "worker_resumed",
      project: "shop",
      task: "task-000001",
      terminal: "t2",
    });
    expect((await taskNamed(f.deps, "task-000001"))?.terminal).toBe("t2");
  });

  it("refuses when the project's Captain is not running", async () => {
    const f = await ended();
    f.terminals.live.length = 0;
    await expect(workerFor(f.deps, f.task)).rejects.toThrow(/^Start the shop Captain first: ask the Coordinator\.$/);
    expect(f.terminals.launched).toHaveLength(1);
  });

  it("refuses a task with no pinned repo", async () => {
    const f = await ended();
    await expect(workerFor(f.deps, { ...f.task, repo: null })).rejects.toThrow(
      /^task-000001 has no pinned repo \(it is from before phase 2\), so its worker can't resume\.$/,
    );
    expect(f.terminals.launched).toHaveLength(1);
  });

  it("refuses when the worktree is gone or changed", async () => {
    const f = await ended();
    f.worktrees.verifyError = new Error("not a git repository");
    await expect(workerFor(f.deps, f.task)).rejects.toThrow(
      /^The worktree of task-000001 is gone or changed, so its worker can't resume\. not a git repository$/,
    );
    expect(f.terminals.launched).toHaveLength(1);
  });

  it("removes the terminal and refuses when there is no conversation to continue", async () => {
    const f = await ended({ trust: TRUST });
    f.terminals.trustOutcomes.push("no_session");
    await expect(workerFor(f.deps, f.task)).rejects.toThrow(
      /^The worker found no conversation to continue in \/worktrees\/brigade\/login-000001, so brigade removed it\.$/,
    );
    expect(f.terminals.removed).toEqual(["t2"]);
    expect(f.terminals.launched).toHaveLength(2);
  });

  it("removes the terminal when the resumed worker never becomes ready", async () => {
    const f = await ended({ trust: TRUST });
    f.terminals.trustOutcomes.push("timeout");
    await expect(workerFor(f.deps, f.task)).rejects.toThrow(
      /^The worker in terminal t2 never became ready, so brigade removed it\.$/,
    );
    expect(f.terminals.removed).toEqual(["t2"]);
  });

  it("starts one worker when two resumes come at once", async () => {
    const f = await ended();
    const [a, b] = await Promise.all([workerFor(f.deps, f.task), workerFor(f.deps, f.task)]);
    expect([a, b]).toEqual([
      { address: "t2", resumed: true },
      { address: "t2", resumed: false },
    ]);
    expect(f.terminals.launched).toHaveLength(2);
  });
});
