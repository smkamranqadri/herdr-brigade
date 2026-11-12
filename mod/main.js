// The Brigade panel for herdr-app: the Coordinator, each project's Captain and tasks with live status, and the latest
// events. A click on an agent opens its tab (`brigade open`): the Coordinator's in the Brigade space, a Captain's or a
// task's worker in the project's space. A task whose worker has ended is resumed first. It changes nothing else.
// In its own layout column, the "brigade.toggle" key folds it to a rail, and the logo at the rail's top unfolds it.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, layout, nextCommand, terminals, theme, run, readTextFile, setShared, shared, watchFolder } from "herdr";
// A namespace import: a config.js written before `OPEN` existed still loads, and its clicks peek as before.
import * as config from "./config.js";
import { PANEL_ID, buildModel, configProjects, isRail, panelWidth, parseEvents, toggledWidth } from "./model.js";

const { CONFIG_FILE, START, STATE_DIR } = config;
/** `brigade open` for this same config and state, without its target; null in a config.js from before it. */
const OPEN = config.OPEN ?? null;
const EVENTS_FILE = `${STATE_DIR}/events.jsonl`;
/** The column's width before it folded, so unfolding brings it back. */
const WIDTH_KEY = "brigade.width";
/** Used only while the state folder doesn't exist yet, so it can't be watched. */
const RETRY_MS = 5000;
/** brigade start waits up to 30 s for a trust prompt, then up to 10 s for herdr-app to see the terminal. */
const START_TIMEOUT_MS = 90_000;
/** brigade open waits up to 10 s for herdr-app to see the terminal, then up to 10 s for its tab. */
const OPEN_TIMEOUT_MS = 30_000;
/**
 * Opening a task can also resume its worker: up to 90 s for another resume of it to finish, 30 s for a trust prompt,
 * then the tab as above.
 */
const TASK_OPEN_TIMEOUT_MS = 180_000;

const localTime = (iso) => new Date(iso).toTimeString().slice(0, 5);

export default class Brigade extends View {
  init(_props, cx) {
    this.events = [];
    this.projects = [];
    /** While the Start button's `brigade start` runs; then its error, if it failed. */
    this.starting = false;
    this.startError = null;
    /** Why the last `brigade open` failed, or null. */
    this.openError = null;
    /** Targets whose `brigade open` still runs. */
    this.opening = new Set();
    this.watch(cx);
    this.listen(cx);
  }

  /** Key commands: "brigade.toggle" in keys.json. */
  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "toggle") this.toggle();
        cx.notify();
      }
    });
  }

  /** Folds the column to the rail or back. Does nothing in a window, which has no column. */
  toggle() {
    const px = panelWidth(layout());
    if (px === null) return;
    if (!isRail(px)) setShared(WIDTH_KEY, px);
    run("layout.resize", { id: PANEL_ID, px: toggledWidth(px, shared(WIDTH_KEY)) });
  }

  /** The Brigade logo. In the rail it unfolds the column; in the full panel it only marks the title. */
  logo(t, unfolds) {
    const mark = div()
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.accent)
      .child(svg("mods/brigade/logo.svg").size(17));
    if (!unfolds) return mark;
    return mark
      .id("brigade-logo")
      .hover((s) => s.bg(t.hover))
      .tooltip("Show Brigade")
      .on_click(() => this.toggle());
  }

  /**
   * One 32 px rail cell, like the left sidebar's: an icon or letter, with a status dot in its corner. A click shows
   * that agent (or runs `onClick`); the tooltip names it.
   */
  railCell(id, face, status, tip, t, onClick) {
    return h_flex()
      .id(id)
      .relative()
      .w(32)
      .h(26)
      .flex_none()
      .rounded(6)
      .justify_center()
      .items_center()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .when(onClick !== null, (el) => el.on_click(onClick))
      .child(face)
      .when(status !== undefined, (el) => el.child(div().absolute().top(3).right(3).child(this.dot(status, t))));
  }

  /** A letter in a small square, as the left sidebar draws a space. */
  letter(text, t) {
    return h_flex()
      .size(18)
      .rounded(5)
      .bg(t.raised)
      .items_center()
      .justify_center()
      .text_size(10.5)
      .font_bold()
      .text_color(t.foreground)
      .child([...text][0]?.toUpperCase() ?? "?");
  }

  /**
   * The folded column: the toggle, then the Coordinator (or Start), and each project's Captain with a dot per open
   * task. Each cell opens its agent, as the full panel's rows do.
   */
  rail(m, t) {
    const open = (address) => (address === null ? null : (_e, cx) => this.openTab(address, cx));
    const openTask = (task) => (_e, cx) => this.openTask(task, cx);
    const coordinator =
      m.coordinator === null
        ? this.railCell(
            "rail-start",
            div()
              .text_color(t.muted)
              .child(this.starting ? "…" : "▶"),
            undefined,
            this.startError ?? (this.starting ? "Starting…" : "Start brigade"),
            t,
            (_e, cx) => this.start(cx),
          )
        : this.railCell(
            "rail-coordinator",
            svg("mods/brigade/brigade.svg").size(15).text_color(t.muted),
            m.coordinator.status,
            `Coordinator · ${m.coordinator.status ?? "starting"}`,
            t,
            open(m.coordinator.address),
          );
    const project = (p) => {
      const openTasks = p.tasks.filter((task) => task.state !== "finished");
      return v_flex()
        .gap(2)
        .items_center()
        .child(
          this.railCell(
            `rail-${p.name}`,
            this.letter(p.name, t),
            p.captain?.status,
            `${p.name} · ${p.captain ? `Captain ${p.captain.status ?? "starting"}` : "no Captain"} · ${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}`,
            t,
            open(p.captain?.address ?? null),
          ),
        )
        .children(
          openTasks.map((task) =>
            this.railCell(
              `rail-task-${task.id}`,
              this.dot(task.waiting ? "blocked" : task.status, t),
              undefined,
              `${task.title} · ${task.waiting ? "waiting on you" : task.state}`,
              t,
              openTask(task),
            ),
          ),
        );
    };
    return v_flex()
      .size_full()
      .bg(t.surface)
      .py(10)
      .gap(6)
      .items_center()
      .text_size(12)
      .overflow_y_scrollbar()
      .child(this.logo(t, true))
      .child(coordinator)
      .child(div().w(24).h(1).flex_none().bg(t.border))
      .children(m.projects.map(project));
  }

  watch(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        this.events = parseEvents(await readTextFile(EVENTS_FILE));
        this.projects = configProjects(await readTextFile(CONFIG_FILE));
        cx.notify();
        try {
          await watchFolder(STATE_DIR);
        } catch {
          // No state folder yet (brigade hasn't started): look again in a while.
          cx.timer.after(RETRY_MS, (cx) => this.watch(cx));
          return;
        }
      }
    });
  }

  dot(status, t) {
    return div()
      .size(8)
      .rounded(4)
      .flex_none()
      .bg(t[status] ?? t.unknown);
  }

  agentLine(id, label, agent, t) {
    return h_flex()
      .id(id)
      .gap(8)
      .px(8)
      .py(5)
      .rounded(6)
      .items_center()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.openTab(agent.address, cx))
      .child(this.dot(agent.status, t))
      .child(div().flex_1().truncate().child(label))
      .child(
        div()
          .text_color(t.dim)
          .child(`${agent.harness} · ${agent.status ?? "starting"}`),
      );
  }

  /** "PR #42 open · 3m": the number, its last known state, and how long ago brigade read it. */
  prChip(pr, t) {
    const color = pr.state === "merged" ? t.accent : pr.state === "closed" ? t.dim : t.working;
    const age = pr.checkedAt ? ` · ${Math.max(0, Math.round((Date.now() - Date.parse(pr.checkedAt)) / 60000))}m` : "";
    return div()
      .px(6)
      .rounded(4)
      .border(1)
      .border_color(t.border)
      .text_size(11)
      .text_color(color)
      .child(`PR #${pr.number} ${pr.state ?? "?"}${age}`);
  }

  taskLine(task, t) {
    const color = task.waiting ? t.blocked : task.state === "finished" ? t.done : t.foreground;
    const state = task.waiting ? "waiting on you" : task.state;
    return v_flex()
      .id(`task-${task.id}`)
      .gap(2)
      .px(8)
      .py(5)
      .ml(14)
      .rounded(6)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.openTask(task, cx))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(this.dot(task.waiting ? "blocked" : task.status, t))
          .child(div().flex_1().truncate().text_color(color).child(task.title))
          .child(div().text_color(t.dim).child(`${task.spec.harness} · ${state}`)),
      )
      .child(
        // The PR chip sits on this second line: on the first it left the title no room in the 368 px panel.
        h_flex()
          .gap(8)
          .pl(16)
          .items_center()
          .child(
            div()
              .flex_1()
              .text_size(11.5)
              .text_color(t.muted)
              .truncate()
              .child(task.note ?? task.branch),
          )
          .when(task.pr !== null, (el) => el.child(this.prChip(task.pr, t))),
      );
  }

  /** Opens the Coordinator's or a Captain's tab. A config.js from before `OPEN` shows it over your tab (peek). */
  openTab(address, cx) {
    if (OPEN === null) return run("terminal.peek", { terminal: address });
    this.runOpen(address, OPEN_TIMEOUT_MS, cx);
  }

  /** Opens a task's worker, resuming it first if it has ended. A config.js from before `OPEN` peeks at a running one. */
  openTask(task, cx) {
    if (OPEN !== null) return this.runOpen(task.id, TASK_OPEN_TIMEOUT_MS, cx);
    if (task.address !== null) run("terminal.peek", { terminal: task.address });
  }

  /** Runs `brigade open <target>`, and says why when it fails. Clicks on a target that is still opening are ignored. */
  runOpen(target, timeout, cx) {
    if (this.opening.has(target)) return;
    this.opening.add(target);
    cx.spawn(async (cx) => {
      let error = null;
      try {
        const r = await exec(OPEN[0], [...OPEN.slice(1), target], { timeout });
        if (r.code !== 0) error = (r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.code}`;
      } catch (err) {
        error = String(err);
      }
      this.opening.delete(target);
      this.openError = error;
      cx.notify();
    });
  }

  /** Runs `brigade start`, which opens the Brigade space with the Coordinator in it. Ignores clicks while it runs. */
  start(cx) {
    if (this.starting) return;
    this.starting = true;
    this.startError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec(START[0], START.slice(1), { timeout: START_TIMEOUT_MS });
        if (r.code !== 0) this.startError = (r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.code}`;
      } catch (err) {
        this.startError = String(err);
      }
      this.starting = false;
      cx.notify();
    });
  }

  startButton(t) {
    return v_flex()
      .gap(6)
      .child(div().text_color(t.muted).child("No Coordinator is running. Start it, then chat with it here."))
      .child(
        h_flex()
          .id("start")
          .h(26)
          .px(10)
          .flex_none()
          .self_start()
          .items_center()
          .rounded(7)
          .text_size(12)
          .bg(t.solid)
          .text_color(t.solid_foreground)
          .cursor_pointer()
          .hover((s) => s.opacity(0.85))
          .on_click((_e, cx) => this.start(cx))
          .child(this.starting ? "Starting…" : "Start brigade"),
      )
      .when(this.startError !== null, (el) =>
        el.child(div().text_size(11.5).text_color(t.blocked).child(`Couldn't start: ${this.startError}`)),
      );
  }

  render() {
    const t = theme();
    const m = buildModel(terminals(), this.events, this.projects);
    const px = panelWidth(layout());
    if (isRail(px)) return this.rail(m, t);
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    return v_flex()
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .p(12)
      .gap(10)
      .text_size(13)
      .overflow_y_scrollbar()
      .child(
        // The title and the counts on two lines: one line doesn't fit the 368 px side panel.
        v_flex()
          .gap(4)
          .child(
            h_flex()
              .items_center()
              .gap(6)
              .child(this.logo(t, false))
              .child(div().text_size(15).font_semibold().child("Brigade")),
          )
          .child(
            h_flex()
              .flex_wrap()
              .gap(10)
              .text_size(12)
              .child(div().text_color(t.working).child(`${m.counts.working} working`))
              .child(
                div()
                  .text_color(m.counts.waiting ? t.blocked : t.dim)
                  .child(`${m.counts.waiting} waiting on you`),
              )
              .child(div().text_color(t.dim).child(`${m.counts.finished} finished`)),
          ),
      )
      .when(this.openError !== null, (el) =>
        el.child(div().text_size(11.5).text_color(t.blocked).child(`Couldn't open it: ${this.openError}`)),
      )
      .when(m.coordinator === null, (el) => el.child(this.startButton(t)))
      .when(m.coordinator !== null, (el) => el.child(this.agentLine("coordinator", "Coordinator", m.coordinator, t)))
      .children(
        m.projects.map((p) =>
          v_flex()
            .gap(2)
            .child(
              label(
                `PROJECT · ${p.name} · ${p.notes.notes} ${p.notes.notes === 1 ? "note" : "notes"}${p.notes.openSuggestions ? ` · ${p.notes.openSuggestions} to settle` : ""}`,
              ),
            )
            .when(p.captain !== null, (el) => el.child(this.agentLine(`captain-${p.name}`, "Captain", p.captain, t)))
            .children(p.tasks.map((task) => this.taskLine(task, t))),
        ),
      )
      .child(
        v_flex()
          .gap(4)
          .pt(8)
          .border_t(1)
          .border_color(t.border)
          .child(label("LATEST EVENTS"))
          .when(m.recent.length === 0, (el) => el.child(div().text_color(t.dim).child("Nothing yet.")))
          .children(
            m.recent.map((e, i) =>
              h_flex()
                .id(`event-${i}`)
                .gap(8)
                .text_size(12)
                .child(div().w(40).flex_none().text_color(t.dim).child(localTime(e.at)))
                .child(div().flex_1().truncate().child(e.text)),
            ),
          ),
      );
  }
}
