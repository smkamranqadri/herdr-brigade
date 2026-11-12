import { describe, expect, it } from "vitest";
import { deriveNotes } from "../src/domain/notes.ts";
import { derivePrs as domainDerivePrs } from "../src/domain/pullRequests.ts";
import { deriveTasks as domainDeriveTasks } from "../src/domain/tasks.ts";
import {
  buildModel,
  configProjects,
  derivePrs,
  deriveTasks,
  eventText,
  isRail,
  noteCounts,
  panelWidth,
  parseEvents,
  toggledWidth,
} from "./model.js";

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
    const resumed = {
      at: "2026-11-09T10:03:00.000Z",
      kind: "worker_resumed",
      project: "shop",
      task: "task-b",
      terminal: "t77",
    };
    const events = [...EVENTS, followUp, resumed];
    expect(deriveTasks(events)).toEqual(domainDeriveTasks(events));
    expect(deriveTasks(events).find((t) => t.id === "task-b")?.terminal).toBe("t77");
  });
});

describe("buildModel", () => {
  const m = buildModel(TERMINALS, EVENTS);

  it("counts only the terminals of its own instance", () => {
    const other = buildModel(TERMINALS, EVENTS, [], "e2e");
    expect(other.coordinator).toBeNull();
    expect(other.projects.every((p) => p.captain === null)).toBe(true);
  });

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
    expect(buildModel([], [], [])).toEqual({
      coordinator: null,
      projects: [],
      counts: { working: 0, waiting: 0, finished: 0 },
      recent: [],
    });
  });
});

describe("eventText", () => {
  it("names a resumed worker", () => {
    expect(eventText({ kind: "worker_resumed", project: "shop", task: "task-b", terminal: "t77" })).toBe(
      "task-b: worker resumed",
    );
  });

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

describe("notes in the panel", () => {
  const NOTE_EVENTS = [
    { at: "1", kind: "note_added", note: "n1", project: "shop", text: "a", source: "owner", task: null },
    { at: "2", kind: "note_added", note: "n2", project: "shop", text: "b", source: "owner", task: null },
    { at: "3", kind: "note_removed", note: "n2", project: "shop" },
    { at: "4", kind: "note_suggested", suggestion: "s1", project: "shop", task: "t", text: "c", why: "w" },
    { at: "5", kind: "note_suggested", suggestion: "s2", project: "shop", task: "t", text: "d", why: "w" },
    {
      at: "6",
      kind: "suggestion_resolved",
      suggestion: "s1",
      project: "shop",
      outcome: "accept",
      reason: "r",
      note: "n3",
      text: "c",
    },
    {
      at: "7",
      kind: "suggestion_resolved",
      suggestion: "s1",
      project: "shop",
      outcome: "accept",
      reason: "r",
      note: "n4",
      text: "again",
    },
    { at: "8", kind: "note_added", note: "n9", project: "blog", text: "x", source: "owner", task: null },
    { at: "9", kind: "note_changed", note: "n1", project: "shop", text: "a, corrected" },
    { at: "10", kind: "note_suggested", suggestion: "s3", project: "shop", task: "t", text: "e", why: "w" },
    {
      at: "11",
      kind: "suggestion_resolved",
      suggestion: "s3",
      project: "shop",
      outcome: "merge",
      reason: "r",
      note: "n1",
      text: "a, merged",
      base: "a",
    },
  ];

  it("counts notes and open suggestions the same way brigade's own fold does", () => {
    const domain = deriveNotes(NOTE_EVENTS, "shop");
    expect(noteCounts(NOTE_EVENTS, "shop")).toEqual({
      notes: domain.notes.length,
      openSuggestions: domain.suggestions.filter((s) => s.outcome === null).length,
    });
    expect(noteCounts(NOTE_EVENTS, "shop")).toEqual({ notes: 2, openSuggestions: 2 });
  });

  it("shows a configured project with notes but no Captain or task", () => {
    const m = buildModel([], NOTE_EVENTS, configProjects(JSON.stringify({ projects: [{ name: "blog" }] })));
    expect(m.projects).toEqual([{ name: "blog", captain: null, tasks: [], notes: { notes: 1, openSuggestions: 0 } }]);
    expect(configProjects("{ half-written")).toEqual([]);
  });
});

describe("PR chips", () => {
  const PR_EVENTS = [
    created("task-a", "Login", "t3", "2026-11-09T10:00:10.000Z"),
    {
      at: "2026-11-09T10:05:00.000Z",
      kind: "pr_opened",
      task: "task-a",
      repo: "acme/shop",
      number: 7,
      url: "u7",
      head: "brigade/task-a",
      base: "main",
    },
    {
      at: "2026-11-09T10:06:00.000Z",
      kind: "pr_state",
      task: "task-a",
      number: 7,
      state: "merged",
      headSha: "abc",
      mergedAt: "2026-11-09T10:06:00.000Z",
    },
    {
      at: "2026-11-09T10:07:00.000Z",
      kind: "pr_opened",
      task: "task-a",
      repo: "acme/shop",
      number: 7,
      url: "u7",
      head: "brigade/task-a",
      base: "main",
    },
    {
      at: "2026-11-09T10:08:00.000Z",
      kind: "pr_state",
      task: "task-a",
      number: 9,
      state: "closed",
      headSha: "x",
      mergedAt: null,
    },
  ];

  it("folds PRs the same way brigade's own fold does", () => {
    expect(derivePrs(PR_EVENTS)).toEqual(domainDerivePrs(PR_EVENTS));
  });

  it("puts each task's PR on its row", () => {
    const task = buildModel([], PR_EVENTS, []).projects[0].tasks[0];
    expect(task.pr).toEqual({
      repo: "acme/shop",
      number: 7,
      url: "u7",
      head: "brigade/task-a",
      base: "main",
      state: "merged",
      headSha: "abc",
      checkedAt: "2026-11-09T10:06:00.000Z",
    });
  });
});

describe("the panel's column", () => {
  const tree = (px) => ({
    id: "root",
    type: "row",
    children: [
      { id: "work", type: "column", children: [{ id: "main", type: "block" }] },
      { id: "brigade", type: "block", size: { px }, content: { mod: "brigade" } },
    ],
  });

  it("reads the brigade column's width anywhere in the layout", () => {
    expect(panelWidth(tree(368))).toBe(368);
    expect(panelWidth({ id: "root", children: [{ id: "outer", children: [tree(300)] }] })).toBe(300);
  });

  it("has no width in a layout without the column, as in a window", () => {
    expect(panelWidth({ id: "root", children: [{ id: "main" }] })).toBeNull();
    expect(panelWidth(null)).toBeNull();
  });

  it("draws the rail below 160 px, and never without a column", () => {
    expect(isRail(44)).toBe(true);
    expect(isRail(159)).toBe(true);
    expect(isRail(160)).toBe(false);
    expect(isRail(null)).toBe(false);
  });

  it("folds to the 44 px rail and unfolds to the saved width, else 368 px", () => {
    expect(toggledWidth(400, undefined)).toBe(44);
    expect(toggledWidth(44, 420)).toBe(420);
    expect(toggledWidth(44, undefined)).toBe(368);
  });
});
