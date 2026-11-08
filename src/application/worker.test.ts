import { describe, expect, it } from "vitest";
import { ctx, fakeDeps, TEST_CONFIG } from "./fakes.ts";
import { askOwner, commitWork, finishTask, messageCaptain } from "./worker.ts";

const worker = ctx({ role: "worker", terminal: "t5", project: "shop", task: "task-1", title: "Login", parent: "t3" });

describe("finishTask", () => {
  it("records the summary and reports it to the Captain", async () => {
    const f = fakeDeps();
    expect(await finishTask(f.deps, worker, { summary: "Fixed" })).toBe("Sent to your Captain. End your turn now.");
    expect(f.events.events).toEqual([
      { kind: "task_finished", task: "task-1", summary: "Fixed", at: "2026-11-08T10:00:00.000Z" },
    ]);
    expect(f.terminals.sent).toEqual([{ address: "t3", text: '[brigade] Task task-1 "Login" finished: Fixed' }]);
  });

  it("refuses an agent that is not a worker", async () => {
    const f = fakeDeps();
    await expect(finishTask(f.deps, ctx({ role: "captain", project: "shop" }), { summary: "x" })).rejects.toThrow(
      "Only a worker started by a Captain can do this.",
    );
    expect(f.terminals.sent).toEqual([]);
  });
});

describe("askOwner", () => {
  it("records the question and passes it to the Captain", async () => {
    const f = fakeDeps();
    await askOwner(f.deps, worker, { question: "Which color?" });
    expect(f.events.events[0]).toMatchObject({ kind: "task_asked", task: "task-1", question: "Which color?" });
    expect(f.terminals.sent).toEqual([
      { address: "t3", text: '[brigade] Task task-1 "Login" asks the owner: Which color?' },
    ]);
  });
});

describe("messageCaptain", () => {
  it("sends a note without changing the task's state", async () => {
    const f = fakeDeps();
    await messageCaptain(f.deps, worker, { text: "This touches the API too" });
    expect(f.terminals.sent).toEqual([
      { address: "t3", text: '[brigade] Task task-1 "Login" says: This touches the API too' },
    ]);
    expect(f.events.events[0]).toMatchObject({ kind: "message_sent", from: "worker", to: "captain", task: "task-1" });
  });
});

describe("commitWork", () => {
  const created = {
    at: "1",
    kind: "task_created",
    project: "shop",
    task: "task-1",
    title: "Login",
    branch: "brigade/login-1",
    worktree: "/worktrees/brigade/login-1",
    terminal: "t5",
    spec: { harness: "codex", model: "gpt-x", effort: "low", permissions: "auto" },
  } as const;

  it("commits in the task's own worktree from the event log, and records the commit", async () => {
    const f = fakeDeps();
    f.events.events.push(created);
    expect(await commitWork(f.deps, worker, { message: "Add login" })).toBe(
      "Committed 1 file as abc123def456 on brigade/login-1.",
    );
    expect(f.worktrees.commits).toEqual([
      {
        target: { worktree: "/worktrees/brigade/login-1", repo: "/repos/shop", branch: "brigade/login-1" },
        message: "Add login",
      },
    ]);
    expect(f.events.events.at(-1)).toEqual({
      kind: "task_committed",
      task: "task-1",
      sha: "abc123def456",
      message: "Add login",
      at: "2026-11-08T10:00:00.000Z",
    });
  });

  it("says so when there is nothing to commit, and records nothing", async () => {
    const f = fakeDeps();
    f.events.events.push(created);
    f.worktrees.nextCommit = null;
    expect(await commitWork(f.deps, worker, { message: "x" })).toBe("Nothing to commit: your worktree has no changes.");
    expect(f.events.events).toHaveLength(1);
  });

  it("refuses to commit for a project that is no longer in the config", async () => {
    const f = fakeDeps({ config: { ...TEST_CONFIG, projects: [] } });
    f.events.events.push(created);
    await expect(commitWork(f.deps, worker, { message: "x" })).rejects.toThrow(
      "Project shop is no longer in the config, so brigade won't commit for it.",
    );
    expect(f.worktrees.commits).toEqual([]);
  });

  it("refuses a task brigade has no record of, and any agent that is not a worker", async () => {
    const f = fakeDeps();
    await expect(commitWork(f.deps, worker, { message: "x" })).rejects.toThrow(
      "Brigade has no record of task-1, so it can't find your worktree.",
    );
    await expect(commitWork(f.deps, ctx({ role: "captain", project: "shop" }), { message: "x" })).rejects.toThrow(
      "Only a worker started by a Captain can do this.",
    );
    expect(f.worktrees.commits).toEqual([]);
  });
});
