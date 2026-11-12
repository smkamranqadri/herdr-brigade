// What the Brigade panel shows, worked out from hc terminals and the event log. Plain JavaScript with no imports,
// so herdr-app can run it and Vitest can test it (mod/model.test.js). Task state follows src/domain/tasks.ts;
// a test checks the two agree on the same events.

const RECENT_EVENTS = 8;

/** Whole lines of the event log as events. A last line without its newline is still being written; bad lines are skipped. */
export function parseEvents(text) {
  const complete = (text ?? "").slice(0, (text ?? "").lastIndexOf("\n") + 1);
  const events = [];
  for (const line of complete.split("\n")) {
    if (line === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A damaged line: brigade's own reader reports it; the panel just leaves it out.
    }
  }
  return events;
}

function applyEvent(task, e) {
  if (e.kind === "task_finished") return { ...task, state: "finished", note: e.summary, updatedAt: e.at };
  if (e.kind === "task_asked") return { ...task, state: "asking", note: e.question, updatedAt: e.at };
  if (e.kind === "message_sent" && e.to === "worker") return { ...task, state: "working", updatedAt: e.at };
  if (e.kind === "worker_resumed") return { ...task, terminal: e.terminal, updatedAt: e.at };
  return task;
}

/** One entry per task, in the order the tasks were created. */
export function deriveTasks(events) {
  const tasks = new Map();
  for (const e of events) {
    if (e.kind === "task_created") {
      const { project, task, title, branch, worktree, terminal, spec, at } = e;
      const pinned = { repo: e.repo ?? null, baseBranch: e.baseBranch ?? null };
      tasks.set(task, {
        id: task,
        project,
        title,
        branch,
        worktree,
        terminal,
        spec,
        ...pinned,
        state: "working",
        note: null,
        updatedAt: at,
      });
    } else if ("task" in e && tasks.has(e.task)) {
      tasks.set(e.task, applyEvent(tasks.get(e.task), e));
    }
  }
  return [...tasks.values()];
}

/** Each task's newest PR and its last known state, folded as src/domain/pullRequests.ts does (a test checks). */
export function derivePrs(events) {
  const prs = new Map();
  for (const e of events) {
    if (e.kind === "pr_opened") {
      const known = prs.get(e.task);
      const same = known?.number === e.number && known.repo === e.repo;
      const { repo, number, url, head, base } = e;
      const state = same
        ? { state: known.state, headSha: known.headSha, checkedAt: known.checkedAt }
        : { state: "open", headSha: null, checkedAt: e.at };
      prs.set(e.task, { repo, number, url, head, base, ...state });
    }
    const pr = e.kind === "pr_state" ? prs.get(e.task) : undefined;
    if (pr && pr.number === e.number) prs.set(e.task, { ...pr, state: e.state, headSha: e.headSha, checkedAt: e.at });
  }
  return prs;
}

/** Settles one resolution the way src/domain/notes.ts does: the first wins, and a merge needs its note unchanged. */
function settle(texts, open, settled, e) {
  if (!open.has(e.suggestion)) return;
  if (e.outcome === "merge") {
    const target = texts.get(e.note);
    if (target === undefined || (e.base !== undefined && target !== e.base)) return;
    texts.set(e.note, e.text);
  }
  if (e.outcome === "accept" && e.note !== null && !texts.has(e.note)) texts.set(e.note, e.text);
  open.delete(e.suggestion);
  settled.add(e.suggestion);
}

/** A project's note count and open suggestions, folded as src/domain/notes.ts does (a test checks they agree). */
export function noteCounts(events, project) {
  const texts = new Map();
  const open = new Set();
  const settled = new Set();
  for (const e of events) {
    if (e.project !== project) continue;
    if (e.kind === "note_added") texts.set(e.note, e.text);
    if (e.kind === "note_changed" && texts.has(e.note)) texts.set(e.note, e.text);
    if (e.kind === "note_removed") texts.delete(e.note);
    if (e.kind === "note_suggested" && !settled.has(e.suggestion)) open.add(e.suggestion);
    if (e.kind === "suggestion_resolved") settle(texts, open, settled, e);
  }
  return { notes: texts.size, openSuggestions: open.size };
}

/** Project names from config.json's text, or none when it can't be read. */
export function configProjects(text) {
  try {
    const projects = JSON.parse(text ?? "").projects;
    return Array.isArray(projects) ? projects.map((p) => p.name).filter((n) => typeof n === "string") : [];
  } catch {
    // No config, or one being edited: the panel shows the projects it finds in the event log and terminals.
    return [];
  }
}

/** One line of text for an event in the panel's recent list. */
export function eventText(e) {
  switch (e.kind) {
    case "agent_started":
      return e.role === "captain" ? `Captain for ${e.project} started` : "Coordinator started";
    case "task_created":
      return `${e.project}: started "${e.title}" on ${e.spec.harness}`;
    case "project_added":
      return `Project ${e.project} added${e.github ? ` (github.com/${e.github})` : ""}`;
    case "project_changed":
      return `Project ${e.project} now starts from ${e.baseBranch}`;
    case "task_committed":
      return `${e.task}: committed ${e.sha.slice(0, 7)}`;
    case "worker_resumed":
      return `${e.task}: worker resumed`;
    case "task_finished":
      return `${e.task} finished: ${e.summary}`;
    case "task_asked":
      return `${e.task} asks: ${e.question}`;
    case "message_sent":
      return `${e.from} → ${e.to}${e.project ? ` (${e.project})` : ""}: ${e.text}`;
    default:
      return e.kind;
  }
}

const agentRow = (t) => ({ address: t.address, status: t.status ?? null, harness: t.labels.harness ?? "" });

/**
 * The panel's model. `terminals` is herdr's terminals() list; only those labelled brigade=<instance> count.
 * A task waits on the owner when its worker asked something, or when its terminal is blocked on a prompt.
 */
export function buildModel(terminals, events, configured = [], instance = "main") {
  const brigade = terminals.filter((t) => t.labels?.brigade === instance);
  const byTask = new Map(brigade.filter((t) => t.labels.task).map((t) => [t.labels.task, t]));
  const prs = derivePrs(events);
  const tasks = deriveTasks(events).map((task) => {
    const term = byTask.get(task.id);
    const status = term?.status ?? null;
    return {
      ...task,
      address: term?.address ?? null,
      pr: prs.get(task.id) ?? null,
      status,
      waiting: task.state === "asking" || status === "blocked",
    };
  });
  const captains = brigade.filter((t) => t.labels.role === "captain");
  const names = [...new Set([...configured, ...captains.map((c) => c.labels.project), ...tasks.map((t) => t.project)])];
  const coordinator = brigade.find((t) => t.labels.role === "coordinator");
  return {
    coordinator: coordinator ? agentRow(coordinator) : null,
    projects: names.map((name) => {
      const captain = captains.find((c) => c.labels.project === name);
      return {
        name,
        captain: captain ? agentRow(captain) : null,
        tasks: tasks.filter((t) => t.project === name),
        notes: noteCounts(events, name),
      };
    }),
    counts: {
      working: tasks.filter((t) => t.state === "working" && t.address !== null && !t.waiting).length,
      waiting: tasks.filter((t) => t.waiting).length,
      finished: tasks.filter((t) => t.state === "finished").length,
    },
    recent: events
      .slice(-RECENT_EVENTS)
      .reverse()
      .map((e) => ({ at: e.at, text: eventText(e) })),
  };
}

/** The id of the panel's own column in a layout (docs/herdr-app.md). Its toggle resizes that block. */
export const PANEL_ID = "brigade";
/** The folded panel's width, as wide as the left sidebar's rail. */
const RAIL_PX = 44;
const DEFAULT_PX = 368;
/** Narrower than this, the panel draws the rail: the left sidebar's rule, so dragging the edge folds it too. */
const RAIL_BELOW_PX = 160;

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** The panel column's width in px, or null when the layout has no such column (the panel shows as a window). */
export function panelWidth(layout) {
  return findNode(layout, PANEL_ID)?.size?.px ?? null;
}

export function isRail(px) {
  return px !== null && px < RAIL_BELOW_PX;
}

/** Where a toggle takes the column: from full width to the rail, or back to the width it had before. */
export function toggledWidth(px, saved) {
  return isRail(px) ? (saved ?? DEFAULT_PX) : RAIL_PX;
}
