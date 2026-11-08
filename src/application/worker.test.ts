import { describe, expect, it } from "vitest";
import { ctx, fakeDeps } from "./fakes.ts";
import { askOwner, finishTask, messageCaptain } from "./worker.ts";

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
