import { describe, expect, it } from "vitest";
import {
  listProjects,
  listTasks,
  openAgent,
  openBrigade,
  openTask,
  sendToCaptain,
  startCoordinator,
} from "./coordinator.ts";
import { createTask } from "./captain.ts";
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

  it("fails when the new-session start never becomes ready", async () => {
    const f = fakeDeps({ trust: { text: "trust", cursor: ">", yes: "Yes", ready: [] } });
    f.terminals.trustOutcomes.push("no_session", "timeout");
    await expect(startCoordinator(f.deps)).rejects.toThrow(
      "The coordinator in terminal t2 started but never became ready.",
    );
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

/** A running Coordinator (t1) with the shop Captain (t2), and a worker (t3) under it. Setup opens are cleared. */
async function brigade() {
  const f = fakeDeps();
  await startCoordinator(f.deps);
  await sendToCaptain(f.deps, ctx({ role: "coordinator", terminal: "t1" }), { project: "shop", message: "Fix login" });
  f.terminals.live.push({
    address: "t3",
    name: "bg-task-1",
    labels: { brigade: "main", role: "worker" },
    status: null,
  });
  f.workspace.opened.length = 0;
  f.terminals.keptOff.length = 0;
  return f;
}

const COORDINATOR_TAB = { address: "t1", folder: "/state/coordinator", first: true, back: false };
const SHOP_CAPTAIN_TAB = { address: "t2", folder: "/state/coordinator", first: false, back: false };

describe("brigade instances", () => {
  it("labels terminals with its own instance, and does not see another instance's Coordinator", async () => {
    const f = fakeDeps();
    f.terminals.live.push({
      address: "t50",
      name: "bg-coordinator",
      labels: { brigade: "main", role: "coordinator", harness: "claude" },
      status: null,
    });
    const deps = { ...f.deps, instance: "e2e" };
    expect(await startCoordinator(deps)).toEqual({ address: "t1", started: true });
    expect(f.terminals.launched[0]?.labels).toMatchObject({ brigade: "e2e", role: "coordinator" });
    expect(await startCoordinator(f.deps)).toEqual({ address: "t50", started: false });
  });
});

describe("openBrigade", () => {
  it("starts the Coordinator, opens it first in the Brigade space, and turns core keep off on it", async () => {
    const f = fakeDeps();
    expect(await openBrigade(f.deps)).toEqual({ address: "t1", started: true });
    expect(f.workspace.checks).toEqual([0]);
    expect(f.workspace.opened).toEqual([COORDINATOR_TAB, COORDINATOR_TAB]);
    expect(f.terminals.keptOff).toEqual(["t1", "t1", "t1"]);
    expect(f.harnesses.requests[0]).toMatchObject({ resume: true });
  });

  it("opens each running Captain in the Brigade space, shows the Coordinator last, and sweeps", async () => {
    const f = await brigade();
    expect(await openBrigade(f.deps)).toEqual({ address: "t1", started: false });
    expect(f.workspace.opened).toEqual([COORDINATOR_TAB, SHOP_CAPTAIN_TAB, COORDINATOR_TAB]);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t1", "t2", "t3"]);
  });

  it("gives no tab to a Captain whose project is no longer in the config", async () => {
    const f = await brigade();
    const deps = { ...f.deps, config: { ...f.deps.config, projects: [] } };
    await openBrigade(deps);
    expect(f.workspace.opened).toEqual([COORDINATOR_TAB, COORDINATOR_TAB]);
  });

  it("starts nothing when the window is not running", async () => {
    const f = fakeDeps();
    f.workspace.checkError = new Error("herdr-app is not running.");
    await expect(openBrigade(f.deps)).rejects.toThrow(/^herdr-app is not running\.$/);
    expect(f.terminals.launched).toEqual([]);
    expect(f.terminals.keptOff).toEqual([]);
  });

  it("starts nothing when hc does not answer", async () => {
    const f = fakeDeps();
    f.terminals.findError = new Error("connection refused");
    await expect(openBrigade(f.deps)).rejects.toThrow(
      /^hc is not answering\. Check it with "hc server status"\. \(connection refused\)$/,
    );
    expect(f.terminals.launched).toEqual([]);
  });

  it("still turns core keep off on every terminal when a tab fails to open", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    await expect(openBrigade(f.deps)).rejects.toThrow(/^no tab for t2$/);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t2", "t3"]);
  });

  it("tries every terminal when keep stays on, and reports each failure once", async () => {
    const f = await brigade();
    f.terminals.keepOffFails.add("t2");
    await expect(openBrigade(f.deps)).rejects.toThrow(/^Core keep is still on for t2\.$/);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t1", "t2", "t3"]);
  });

  it("reports both a failure to open and a failure to turn keep off", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    f.terminals.keepOffFails.add("t3");
    await expect(openBrigade(f.deps)).rejects.toThrow(/^no tab for t2\nCore keep is still on for t3\.$/);
  });

  it("passes on the --new refusal and still sweeps", async () => {
    const f = await brigade();
    await expect(openBrigade(f.deps, { fresh: true })).rejects.toThrow(
      /^A Coordinator is running in t1\. Stop it with "hc kill t1", then run "brigade start --new" again\.$/,
    );
    expect(f.workspace.opened).toEqual([]);
    expect(f.terminals.keptOff).toEqual(["t1", "t2", "t3"]);
  });
});

describe("openAgent", () => {
  it("opens a Captain and the Coordinator in the Brigade space, the Coordinator first, turning core keep off on each", async () => {
    const f = await brigade();
    await openAgent(f.deps, "t2");
    await openAgent(f.deps, "t1");
    expect(f.workspace.checks).toEqual([0, 1]);
    expect(f.workspace.opened).toEqual([SHOP_CAPTAIN_TAB, COORDINATOR_TAB]);
    expect(f.terminals.keptOff).toEqual(["t2", "t1"]);
  });

  it("refuses a worker or an unknown terminal and opens nothing", async () => {
    const f = await brigade();
    await expect(openAgent(f.deps, "t3")).rejects.toThrow(/^t3 is not a running Coordinator or Captain\.$/);
    await expect(openAgent(f.deps, "t9")).rejects.toThrow("t9 is not");
    expect(f.workspace.opened).toEqual([]);
  });

  it("turns core keep off also when the tab fails to open", async () => {
    const f = await brigade();
    f.workspace.openFails.add("t2");
    await expect(openAgent(f.deps, "t2")).rejects.toThrow(/^no tab for t2$/);
    expect(f.terminals.keptOff).toEqual(["t2"]);
  });
});

describe("a new Captain's tab", () => {
  const send = (f: ReturnType<typeof fakeDeps>) =>
    sendToCaptain(f.deps, ctx({ role: "coordinator", terminal: "t9" }), { project: "shop", message: "Fix login" });

  it("opens in the Brigade space, not the project's, shows the owner's tab again, and turns core keep off", async () => {
    const f = fakeDeps();
    expect(await send(f)).toBe(
      "Sent to the shop Captain, which was started for it. End your turn; its report arrives as a [brigade] message.",
    );
    expect(f.workspace.opened).toEqual([{ address: "t1", folder: "/state/coordinator", first: false, back: true }]);
    expect(f.terminals.keptOff).toEqual(["t1"]);
  });

  it("still runs and gets the request when its tab fails, and the reply says so", async () => {
    const f = fakeDeps();
    f.workspace.openFails.add("t1");
    expect(await send(f)).toBe(
      "Sent to the shop Captain, which was started for it. It runs, but its tab failed (no tab for t1). " +
        'The owner can open it from the panel or with "brigade start". End your turn; its report arrives as a [brigade] message.',
    );
    expect(f.terminals.live.map((t) => t.address)).toEqual(["t1"]);
    expect(f.terminals.keptOff).toEqual(["t1"]);
  });

  it("is not opened again for a Captain that already runs", async () => {
    const f = fakeDeps();
    await send(f);
    await send(f);
    expect(f.workspace.opened).toHaveLength(1);
  });
});

describe("openTask", () => {
  /** The shop Captain in t1 and its task task-000001, whose worker runs in t2. */
  async function withTask() {
    const f = fakeDeps();
    await sendToCaptain(f.deps, ctx({ role: "coordinator", terminal: "t0" }), { project: "shop", message: "x" });
    await createTask(f.deps, ctx({ role: "captain", terminal: "t1", project: "shop" }), {
      title: "Login",
      prompt: "p",
    });
    f.workspace.opened.length = 0;
    f.terminals.keptOff.length = 0;
    return f;
  }
  const workerTab = (address: string) => ({ address, folder: "/repos/shop", first: false, back: false });

  it("opens a running worker's tab in the project's space and stays there", async () => {
    const f = await withTask();
    expect(await openTask(f.deps, "task-000001")).toEqual({ address: "t2", resumed: false });
    expect(f.workspace.checks).toEqual([0]);
    expect(f.workspace.opened).toEqual([workerTab("t2")]);
    expect(f.terminals.keptOff).toEqual(["t2"]);
  });

  it("resumes an ended worker, then opens its tab", async () => {
    const f = await withTask();
    f.terminals.live.splice(1, 1);
    expect(await openTask(f.deps, "task-000001")).toEqual({ address: "t3", resumed: true });
    expect(f.workspace.opened).toEqual([workerTab("t3")]);
  });

  it("refuses an unknown task, and opens nothing when the window is not running", async () => {
    const f = await withTask();
    await expect(openTask(f.deps, "task-999")).rejects.toThrow(/^No task task-999\.$/);
    f.workspace.checkError = new Error("herdr-app is not running.");
    await expect(openTask(f.deps, "task-000001")).rejects.toThrow(/^herdr-app is not running\.$/);
    expect(f.workspace.opened).toEqual([]);
  });

  it("says a resumed worker runs without a tab when its tab fails, and shows it next time without a resume", async () => {
    const f = await withTask();
    f.terminals.live.splice(1, 1);
    f.workspace.openFails.add("t3");
    await expect(openTask(f.deps, "task-000001")).rejects.toThrow(
      /^no tab for t3\nIts worker was resumed and runs in terminal t3 without a tab\. Open the task again to try once more\.$/,
    );
    expect(f.terminals.keptOff).toEqual(["t3"]);
    f.workspace.openFails.clear();
    expect(await openTask(f.deps, "task-000001")).toEqual({ address: "t3", resumed: false });
    expect(f.terminals.launched).toHaveLength(3);
  });

  it("passes on a tab failure for a running worker as it is", async () => {
    const f = await withTask();
    f.workspace.openFails.add("t2");
    await expect(openTask(f.deps, "task-000001")).rejects.toThrow(/^no tab for t2$/);
  });
});
