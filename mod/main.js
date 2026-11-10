// The Brigade panel for herdr-app: the Coordinator, each project's Captain and tasks with live status, and the latest
// events. A click on a row shows that agent's terminal over your tab (peek), where you chat with it. It only shows; it changes nothing.
// In its own layout column, an icon (or the "brigade.toggle" key) folds it to a rail, as the left sidebar does.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, layout, nextCommand, terminals, theme, run, readTextFile, setShared, shared, watchFolder } from "herdr";
import { CONFIG_FILE, START, STATE_DIR } from "./config.js";
import { PANEL_ID, buildModel, configProjects, isRail, panelWidth, parseEvents, toggledWidth } from "./model.js";

const EVENTS_FILE = `${STATE_DIR}/events.jsonl`;
/** The column's width before it folded, so unfolding brings it back. */
const WIDTH_KEY = "brigade.width";
/** Used only while the state folder doesn't exist yet, so it can't be watched. */
const RETRY_MS = 5000;
/** brigade start waits up to 30 s for a trust prompt, then up to 10 s for herdr-app to see the terminal. */
const START_TIMEOUT_MS = 90_000;

const localTime = (iso) => new Date(iso).toTimeString().slice(0, 5);

export default class Brigade extends View {
  init(_props, cx) {
    this.events = [];
    this.projects = [];
    /** While the Start button's `brigade start` runs; then its error, if it failed. */
    this.starting = false;
    this.startError = null;
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

  toggleButton(t, folded) {
    return div()
      .id("panel-toggle")
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(folded ? "Show Brigade" : "Hide Brigade")
      .on_click(() => this.toggle())
      .child(svg("mods/brigade/panel.svg").size(15));
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
    const peek = (address) => (address === null ? null : () => run("terminal.peek", { terminal: address }));
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
            peek(m.coordinator.address),
          );
    const project = (p) => {
      const open = p.tasks.filter((task) => task.state !== "finished");
      return v_flex()
        .gap(2)
        .items_center()
        .child(
          this.railCell(
            `rail-${p.name}`,
            this.letter(p.name, t),
            p.captain?.status,
            `${p.name} · ${p.captain ? `Captain ${p.captain.status ?? "starting"}` : "no Captain"} · ${open.length} open ${open.length === 1 ? "task" : "tasks"}`,
            t,
            peek(p.captain?.address ?? null),
          ),
        )
        .children(
          open.map((task) =>
            this.railCell(
              `rail-task-${task.id}`,
              this.dot(task.waiting ? "blocked" : task.status, t),
              undefined,
              `${task.title} · ${task.waiting ? "waiting on you" : task.state}`,
              t,
              peek(task.address),
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
      .child(this.toggleButton(t, true))
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
      .on_click(() => run("terminal.peek", { terminal: agent.address }))
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
      .when(task.address !== null, (el) => el.on_click(() => run("terminal.peek", { terminal: task.address })))
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

  /** Runs `brigade start`, which starts the Coordinator and shows it over the tab. Ignores clicks while it runs. */
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
              .justify_between()
              .child(div().text_size(15).font_semibold().child("Brigade"))
              .when(px !== null, (el) => el.child(this.toggleButton(t, false))),
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
