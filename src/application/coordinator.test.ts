import { describe, expect, it } from "vitest";
import { listProjects, listTasks, openAgent, openBrigade, sendToCaptain, startCoordinator } from "./coordinator.ts";
import { ctx, FakeWorkspace, fakeDeps } from "./fakes.ts";

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
        outliveParent: false,
        argv: ["claude", "bg-coordinator"],
      },
    ]);
    expect(f.harnesses.requests[0]?.firstMessage).toBeNull();
    expect(f.harnesses.requests[0]?.systemPrompt).toBe("coordinator prompt for Sam");
    expect(f.harnesses.requests[0]).toMatchObject({ resume: true, readDirs: [] });
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

  it("starts a new conversation when asked for a fresh start", async () => {
    const f = fakeDeps();
    await startCoordinator(f.deps, { fresh: true });
    expect(f.harnesses.requests[0]?.resume).toBe(false);
  });

  it("refuses a fresh start while a Coordinator runs, and says how to stop it", async () => {
    const f = fakeDeps();
    await startCoordinator(f.deps);
    await expect(startCoordinator(f.deps, { fresh: true })).rejects.toThrow(
      'A Coordinator is running in t1. Stop it with "hc kill t1", then run "brigade start --new" again.',
    );
    expect(f.terminals.launched).toHaveLength(1);
  });

  it("starts once more with a new session when there was none to resume", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    f.terminals.trustOutcomes.push("no_session");
    expect(await startCoordinator(f.deps)).toEqual({ address: "t2", started: true });
    expect(f.terminals.removed).toEqual(["t1"]);
    expect(f.harnesses.requests.map((r) => r.resume)).toEqual([true, false]);
    expect(f.events.events.map((e) => (e.kind === "agent_started" ? e.terminal : null))).toEqual(["t1", "t2"]);
    expect(f.eventsAtTrust).toEqual([1, 2]);
  });

  it("starts once more only: a second missing session is an error", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    f.terminals.trustOutcomes.push("no_session", "no_session");
    await expect(startCoordinator(f.deps)).rejects.toThrow(
      "The coordinator in terminal t2 started but never became ready.",
    );
    expect(f.terminals.launched).toHaveLength(2);
    expect(f.terminals.removed).toEqual(["t1"]);
  });

  it("does not start again when the agent fails for another reason", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    f.terminals.trustOutcomes.push("timeout");
    await expect(startCoordinator(f.deps)).rejects.toThrow(
      "The coordinator in terminal t1 started but never became ready.",
    );
    expect(f.terminals.launched).toHaveLength(1);
    expect(f.terminals.removed).toEqual([]);
  });

  it("answers the trust prompt when the harness has one", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    await startCoordinator(f.deps);
    expect(f.terminals.trustAnswered).toEqual(["t1"]);
    expect(f.eventsAtTrust).toEqual([1]);
  });
});

describe("sendToCaptain", () => {
  it("starts the project's Captain in its own folder, reading its repo, with the message as its first input", async () => {
    const f = fakeDeps();
    const reply = await sendToCaptain(f.deps, coordinator, { project: "shop", message: "Fix login" });
    expect(reply).toBe(
      "Sent to the shop Captain, which was started for it. End your turn; its report arrives as a [brigade] message.",
    );
    expect(f.terminals.launched[0]).toMatchObject({
      name: "bg-cap-shop",
      cwd: "/state/captains/shop",
      parent: "t9",
      outliveParent: false,
    });
    expect(f.folders.ensured).toEqual(["/state/captains/shop"]);
    expect(f.launchesAtEnsure).toEqual([0]);
    expect(f.harnesses.requests[0]).toMatchObject({ resume: true, readDirs: ["/repos/shop"] });
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

  it("delivers a Captain's first message once when it starts again with a new session", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    f.harnesses.sendFirst = true;
    f.terminals.trustOutcomes.push("no_session");
    await sendToCaptain(f.deps, coordinator, { project: "shop", message: "Fix login" });
    expect(f.terminals.sent).toEqual([{ address: "t2", text: "[brigade] From the Coordinator: Fix login" }]);
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

/** A running Coordinator (t1) with the shop Captain (t2), and a worker (t3) under it. */
async function brigade() {
  const f = fakeDeps();
  const workspace = new FakeWorkspace();
  await startCoordinator(f.deps);
  await sendToCaptain(f.deps, ctx({ role: "coordinator", terminal: "t1" }), { project: "shop", message: "Fix login" });
  f.terminals.live.push({
    address: "t3",
    name: "bg-task-1",
    labels: { brigade: "main", role: "worker" },
    status: null,
  });
  return { ...f, workspace };
}

describe("openBrigade", () => {
  it("starts the Coordinator, opens it first, and turns core keep off on it", async () => {
    const f = fakeDeps();
    const workspace = new FakeWorkspace();
    expect(await openBrigade(f.deps, workspace)).toEqual({ address: "t1", started: true });
    expect(workspace.checks).toEqual([0]);
    expect(workspace.opened).toEqual([
      { address: "t1", first: true },
      { address: "t1", first: true },
    ]);
    expect(f.terminals.keptOff).toEqual(["t1", "t1", "t1"]);
    expect(f.harnesses.requests[0]).toMatchObject({ resume: true });
  });

  it("gives each running Captain a tab, shows the Coordinator last, and sweeps every brigade terminal", async () => {
    const f = await brigade();
    expect(await openBrigade(f.deps, f.workspace)).toEqual({ address: "t1", started: false });
    expect(f.workspace.opened).toEqual([
      { address: "t1", first: true },
      { address: "t2", first: false },
      { address: "t1", first: true },
    ]);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t1", "t2", "t3"]);
  });

  it("starts nothing when the window is not running", async () => {
    const f = fakeDeps();
    const workspace = new FakeWorkspace();
    workspace.checkError = new Error("herdr-app is not running.");
    await expect(openBrigade(f.deps, workspace)).rejects.toThrow(/^herdr-app is not running\.$/);
    expect(f.terminals.launched).toEqual([]);
    expect(f.terminals.keptOff).toEqual([]);
  });

  it("starts nothing when hc does not answer", async () => {
    const f = fakeDeps();
    f.terminals.findError = new Error("connection refused");
    await expect(openBrigade(f.deps, new FakeWorkspace())).rejects.toThrow(
      /^hc is not answering\. Check it with "hc server status"\. \(connection refused\)$/,
    );
    expect(f.terminals.launched).toEqual([]);
  });

  it("still turns core keep off on every terminal when a tab fails to open", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    await expect(openBrigade(f.deps, f.workspace)).rejects.toThrow(/^no tab for t2$/);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t2", "t3"]);
  });

  it("tries every terminal when keep stays on, and reports each failure once", async () => {
    const f = await brigade();
    f.terminals.keepOffFails.add("t2");
    await expect(openBrigade(f.deps, f.workspace)).rejects.toThrow(/^Core keep is still on for t2\.$/);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t2", "t3"]);
  });

  it("reports both a failure to open and a failure to turn keep off", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    f.terminals.keepOffFails.add("t3");
    await expect(openBrigade(f.deps, f.workspace)).rejects.toThrow(/^no tab for t2\nCore keep is still on for t3\.$/);
  });

  it("passes on the --new refusal and still sweeps", async () => {
    const f = await brigade();
    await expect(openBrigade(f.deps, f.workspace, { fresh: true })).rejects.toThrow(
      /^A Coordinator is running in t1\. Stop it with "hc kill t1", then run "brigade start --new" again\.$/,
    );
    expect(f.workspace.opened).toEqual([]);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t3"]);
  });
});

describe("openAgent", () => {
  it("opens a Captain where it is and the Coordinator first, turning core keep off on each", async () => {
    const f = await brigade();
    await openAgent(f.deps, f.workspace, "t2");
    await openAgent(f.deps, f.workspace, "t1");
    expect(f.workspace.checks).toEqual([0, 1]);
    expect(f.workspace.opened).toEqual([
      { address: "t2", first: false },
      { address: "t1", first: true },
    ]);
    expect(f.terminals.keptOff).toEqual(["t2", "t1"]);
  });

  it("refuses a worker or an unknown terminal and opens nothing", async () => {
    const f = await brigade();
    await expect(openAgent(f.deps, f.workspace, "t3")).rejects.toThrow(
      /^t3 is not a running Coordinator or Captain\.$/,
    );
    await expect(openAgent(f.deps, f.workspace, "t9")).rejects.toThrow("t9 is not");
    expect(f.workspace.opened).toEqual([]);
  });

  it("turns core keep off also when the tab fails to open", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    await expect(openAgent(f.deps, f.workspace, "t2")).rejects.toThrow(/^no tab for t2$/);
    expect(f.terminals.keptOff).toEqual(["t2"]);
  });
});
