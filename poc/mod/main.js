// Brigade POC panel: the brigade's agents grouped by project, with live status, and its latest events.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, theme, run, readTextFile, watchFolder } from "herdr";

const STATE_DIR = "/path/to/herdr-brigade/poc/.state";
const EVENTS_FILE = `${STATE_DIR}/events.jsonl`;
const BRIGADE_LABEL = "poc";
const SHOWN_EVENTS = 8;

function parseEvents(text) {
  const events = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    // The writer appends whole lines; a line that doesn't parse is one still being written.
    try { events.push(JSON.parse(line)); } catch { break; }
  }
  return events;
}

function eventText(e) {
  if (e.kind === "task_created") return `Captain started ${e.data.id}: ${e.data.title}`;
  if (e.kind === "finished") return `${e.task} finished: ${e.data.summary}`;
  if (e.kind === "asked") return `${e.task} asks: ${e.data.question}`;
  if (e.kind === "tool_error") return `${e.role} tool error: ${e.data.message}`;
  if (e.kind === "mcp_start") return `${e.role} MCP up (${e.data.hcTerminalFromEnv ?? "no HC_TERMINAL_ID"})`;
  return `${e.kind}`;
}

export default class Brigade extends View {
  init(_props, cx) {
    this.events = [];
    this.reload(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(STATE_DIR);
        this.reload(cx);
      }
    });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      this.events = parseEvents(await readTextFile(EVENTS_FILE));
      cx.notify();
    });
  }

  agentRow(term, t) {
    const status = term.status ?? term.state;
    return h_flex().id(`row-${term.address}`).gap(10).px(10).py(6).rounded(6).items_center()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("agent.focus", { terminal: term.address }))
      .child(div().size(8).rounded(4).bg(t[status] ?? t.unknown))
      .child(div().w(64).text_color(t.muted).child(term.labels.role))
      .child(div().flex_1().truncate().child(term.labels.title ?? term.name))
      .child(div().text_color(t.dim).child(`${status} · ${term.address}`));
  }

  render() {
    const t = theme();
    const crew = terminals().filter((x) => x.labels?.brigade === BRIGADE_LABEL);
    const projects = [...new Set(crew.map((x) => x.labels.project))];
    const recent = this.events.slice(-SHOWN_EVENTS).reverse();
    return v_flex().size_full().bg(t.surface).text_color(t.foreground).p(14).gap(12).text_size(13)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(16).font_semibold().child("Brigade"))
        .child(div().text_color(t.dim).child(`${crew.length} agents`)))
      .when(crew.length === 0, (el) => el.child(div().text_color(t.muted).child("No brigade agents are running. Start a Captain with node poc/launch.mjs.")))
      .children(projects.map((p) => v_flex().gap(2)
        .child(div().text_size(11).text_color(t.dim).child(`PROJECT · ${p}`))
        .children(crew.filter((x) => x.labels.project === p)
          .sort((a, b) => (a.labels.role === "captain" ? -1 : b.labels.role === "captain" ? 1 : 0))
          .map((x) => this.agentRow(x, t)))))
      .child(v_flex().gap(4).pt(8).border_t(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).child("LATEST EVENTS"))
        .children(recent.map((e, i) => h_flex().id(`ev-${i}`).gap(8)
          .child(div().w(64).text_color(t.dim).child(e.at.slice(11, 19)))
          .child(div().flex_1().truncate().child(eventText(e))))));
  }
}
