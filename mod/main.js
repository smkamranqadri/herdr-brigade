// The Brigade panel for herdr-app: the Coordinator, each project's Captain and tasks with live status, and the latest
// events. A click on a row focuses that agent's terminal, where you chat with it. It only shows; it changes nothing.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, theme, run, readTextFile, watchFolder } from "herdr";
import { CONFIG_FILE, STATE_DIR } from "./config.js";
import { buildModel, configProjects, parseEvents } from "./model.js";

const EVENTS_FILE = `${STATE_DIR}/events.jsonl`;
/** Used only while the state folder doesn't exist yet, so it can't be watched. */
const RETRY_MS = 5000;

const localTime = (iso) => new Date(iso).toTimeString().slice(0, 5);

export default class Brigade extends View {
  init(_props, cx) {
    this.events = [];
    this.projects = [];
    this.watch(cx);
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
      .on_click(() => run("agent.focus", { terminal: agent.address }))
      .child(this.dot(agent.status, t))
      .child(div().flex_1().truncate().child(label))
      .child(
        div()
          .text_color(t.dim)
          .child(`${agent.harness} · ${agent.status ?? "starting"}`),
      );
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
      .when(task.address !== null, (el) => el.on_click(() => run("agent.focus", { terminal: task.address })))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(this.dot(task.waiting ? "blocked" : task.status, t))
          .child(div().flex_1().truncate().text_color(color).child(task.title))
          .child(div().text_color(t.dim).child(`${task.spec.harness} · ${state}`)),
      )
      .child(
        div()
          .pl(16)
          .text_size(11.5)
          .text_color(t.muted)
          .truncate()
          .child(task.note ?? task.branch),
      );
  }

  render() {
    const t = theme();
    const m = buildModel(terminals(), this.events, this.projects);
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
          .child(div().text_size(15).font_semibold().child("Brigade"))
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
      .when(m.coordinator === null, (el) =>
        el.child(
          div().text_color(t.muted).child("No Coordinator is running. Run brigade start, then chat with it here."),
        ),
      )
      .when(m.coordinator !== null, (el) => el.child(this.agentLine("coordinator", "Coordinator", m.coordinator, t)))
      .children(
        m.projects.map((p) =>
          v_flex()
            .gap(2)
            .child(
              label(
                `PROJECT · ${p.name} · ${p.notes.notes} notes${p.notes.openSuggestions ? ` · ${p.notes.openSuggestions} to settle` : ""}`,
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
