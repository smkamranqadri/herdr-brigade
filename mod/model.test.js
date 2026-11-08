import { describe, expect, it } from "vitest";
import { deriveTasks as domainDeriveTasks } from "../src/domain/tasks.ts";
import { buildModel, deriveTasks, eventText, parseEvents } from "./model.js";

const spec = { harness: "codex", model: "gpt-x", effort: "low", permissions: "auto" };
const created = (task, title, terminal, at) => ({
  at,
  kind: "task_created",
  project: "shop",
  task,
  title,
  branch: `brigade/${task}`,
  worktree: `/w/${task}`,
  terminal,
  spec,
});
const EVENTS = [
  { at: "2026-11-09T10:00:00.000Z", kind: "agent_started", role: "coordinator", project: null, terminal: "t1", spec },
  { at: "2026-11-09T10:00:05.000Z", kind: "agent_started", role: "captain", project: "shop", terminal: "t2", spec },
  created("task-a", "Login", "t3", "2026-11-09T10:00:10.000Z"),
  created("task-b", "Docs", "t4", "2026-11-09T10:00:11.000Z"),
  created("task-c", "Logo", "t5", "2026-11-09T10:00:12.000Z"),
  { at: "2026-11-09T10:01:00.000Z", kind: "task_committed", task: "task-a", sha: "abc1234def", message: "Add login" },
  { at: "2026-11-09T10:01:01.000Z", kind: "task_finished", task: "task-a", summary: "Login added" },
  { at: "2026-11-09T10:01:02.000Z", kind: "task_asked", task: "task-b", question: "Which docs folder?" },
];
const TERMINALS = [
  { address: "t1", labels: { brigade: "main", role: "coordinator", harness: "claude" }, status: "idle" },
  {
    address: "t2",
    labels: { brigade: "main", role: "captain", project: "shop", harness: "claude" },
    status: "working",
  },
  {
    address: "t3",
    labels: { brigade: "main", role: "worker", project: "shop", task: "task-a", harness: "codex" },
    status: "done",
  },
  {
    address: "t5",
    labels: { brigade: "main", role: "worker", project: "shop", task: "task-c", harness: "codex" },
    status: "blocked",
  },
  { address: "t9", labels: { where: "home" }, status: "working" },
];

describe("parseEvents", () => {
  it("keeps whole lines only and skips damaged ones", () => {
    expect(parseEvents('{"kind":"a"}\nnot json\n{"kind":"b"}\n{"kind":"c"')).toEqual([{ kind: "a" }, { kind: "b" }]);
    expect(parseEvents(null)).toEqual([]);
  });
});

describe("deriveTasks", () => {
  it("agrees with brigade's own task logic on the same events", () => {
    const followUp = {
      at: "2026-11-09T10:02:00.000Z",
      kind: "message_sent",
      from: "captain",
      to: "worker",
      project: "shop",
      task: "task-b",
      text: "docs/",
    };
    const events = [...EVENTS, followUp];
    expect(deriveTasks(events)).toEqual(domainDeriveTasks(events));
  });
});

describe("buildModel", () => {
  const m = buildModel(TERMINALS, EVENTS);

  it("shows the Coordinator and each project's Captain from the brigade's terminals only", () => {
    expect(m.coordinator).toEqual({ address: "t1", status: "idle", harness: "claude" });
    expect(m.projects.map((p) => [p.name, p.captain])).toEqual([
      ["shop", { address: "t2", status: "working", harness: "claude" }],
    ]);
  });

  it("marks a task waiting when it asked something or its terminal is blocked, and counts states", () => {
    expect(m.projects[0].tasks.map((t) => [t.id, t.state, t.address, t.status, t.waiting])).toEqual([
      ["task-a", "finished", "t3", "done", false],
      ["task-b", "asking", null, null, true],
      ["task-c", "working", "t5", "blocked", true],
    ]);
    expect(m.counts).toEqual({ working: 0, waiting: 2, finished: 1 });
  });

  it("lists the latest events newest first, as text", () => {
    expect(m.recent.map((e) => e.text)).toEqual([
      "task-b asks: Which docs folder?",
      "task-a finished: Login added",
      "task-a: committed abc1234",
      'shop: started "Logo" on codex',
      'shop: started "Docs" on codex',
      'shop: started "Login" on codex',
      "Captain for shop started",
      "Coordinator started",
    ]);
  });

  it("is empty with no terminals and no events", () => {
    expect(buildModel([], [])).toEqual({
      coordinator: null,
      projects: [],
      counts: { working: 0, waiting: 0, finished: 0 },
      recent: [],
    });
  });
});

describe("eventText", () => {
  it("names added and changed projects", () => {
    expect(
      eventText({ kind: "project_added", project: "blog", repo: "/r", baseBranch: "main", github: "acme/blog" }),
    ).toBe("Project blog added (github.com/acme/blog)");
    expect(eventText({ kind: "project_added", project: "notes", repo: "/r", baseBranch: "main", github: null })).toBe(
      "Project notes added",
    );
    expect(eventText({ kind: "project_changed", project: "blog", baseBranch: "release" })).toBe(
      "Project blog now starts from release",
    );
  });

  it("names who sent a message to whom", () => {
    expect(
      eventText({ kind: "message_sent", from: "coordinator", to: "captain", project: "shop", text: "Fix it" }),
    ).toBe("coordinator → captain (shop): Fix it");
  });
});
