import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HerdrApp, HerdrAppWorkspace, installMod } from "./herdrApp.ts";

describe("HerdrApp", () => {
  it("shows an agent over the tab (peek), toggles the panel and checks a mod with herdr-app's own commands", async () => {
    const calls: string[][] = [];
    const app = new HerdrApp((args) => {
      calls.push([...args]);
      return Promise.resolve(args[0] === "check" ? "check passed: /m\n" : '{"ok":true}');
    });
    await app.show("t7");
    await app.openPanel();
    expect(await app.check("/m")).toBe("check passed: /m");
    expect(calls).toEqual([
      ["do", "terminal.peek", "--terminal", "t7"],
      ["do", "mod.open", "--name", "brigade"],
      ["check", "/m"],
    ]);
  });
});

describe("HerdrApp.show", () => {
  const scripted = (replies: string[]) => {
    const calls: string[][] = [];
    let clock = 0;
    const run = (args: readonly string[]) => {
      calls.push([...args]);
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      return reply?.startsWith("ERR ") ? Promise.reject(new Error(reply.slice(4))) : Promise.resolve(reply ?? "");
    };
    const app = new HerdrApp(run, { sleep: (ms) => ((clock += ms), Promise.resolve()), now: () => clock });
    return { app, calls };
  };
  const notYet = 'ERR herdr-app do terminal.peek failed: { "error": "no running terminal \\"t7\\"" }';

  it("retries while herdr-app hasn't seen the new terminal yet", async () => {
    const { app, calls } = scripted([notYet, notYet, '{"ok":true}']);
    await app.show("t7");
    expect(calls).toHaveLength(3);
  });

  it("fails at once on any other error, and after 10 seconds of not seeing the terminal", async () => {
    await expect(scripted(["ERR herdr-app do terminal.peek failed: no window"]).app.show("t7")).rejects.toThrow(
      "no window",
    );
    const slow = scripted([notYet]);
    await expect(slow.app.show("t7")).rejects.toThrow("no running terminal");
    expect(slow.calls).toHaveLength(21);
  });
});

describe("installMod", () => {
  it("copies the mod's files into mods/brigade and writes its state folder into config.js", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "brigade-mod-src-"));
    for (const f of ["main.js", "model.js", "mod.json", "brigade.svg", "panel.svg", "model.test.js"])
      await writeFile(path.join(source, f), f);
    const home = await mkdtemp(path.join(tmpdir(), "brigade-herdr-home-"));
    const start = ["env", "BRIGADE_STATE=/s", "/bin/node", "/app/cli.ts", "start"];
    const target = await installMod(source, home, {
      stateDir: '/state/with "quotes"',
      configFile: "/c/config.json",
      start,
    });
    expect(target).toBe(path.join(home, "mods", "brigade"));
    expect((await readdir(target)).sort()).toEqual([
      "brigade.svg",
      "config.js",
      "main.js",
      "mod.json",
      "model.js",
      "panel.svg",
    ]);
    expect(await readFile(path.join(target, "config.js"), "utf8")).toBe(
      [
        '// Written by "brigade mod install"; run it again to change.',
        'export const STATE_DIR = "/state/with \\"quotes\\"";',
        'export const CONFIG_FILE = "/c/config.json";',
        "// The panel's Start button runs this: `brigade start` for this same config and state.",
        'export const START = ["env","BRIGADE_STATE=/s","/bin/node","/app/cli.ts","start"];',
        "",
      ].join("\n"),
    );
  });
});

// `herdr-app ls` as it printed on 2026-11-11 (herdr-app 0.1.15), with made-up ids and folders.
interface TabSpec {
  readonly id: string;
  readonly terminals: readonly string[];
}
const space = (id: string, name: string, folder: string, tabs: readonly TabSpec[]) => ({
  id,
  name,
  folder,
  machine: null,
  active: false,
  tabs: tabs.map((t, i) => ({
    id: t.id,
    name: String(i + 1),
    active: false,
    settled: false,
    terminals: t.terminals.map((terminal) => ({
      terminal,
      pane: `p-${terminal}`,
      status: null,
      app: null,
      name: null,
      sub_agents: [],
    })),
  })),
});
const ls = (...spaces: ReturnType<typeof space>[]) => JSON.stringify({ spaces });

const BRIGADE = { name: "Brigade", folder: "/state/coordinator" };
const work = space("sp-work", "Work", "/home/sam/shop", [{ id: "tb-w1", terminals: ["t1"] }]);

/** A runner that answers each command (`ls`, `status`, or the `do` command's name) from its queue; "ERR x" fails. */
function workspace(replies: Record<string, string | string[]>) {
  const calls: string[][] = [];
  const queues = new Map(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  let clock = 0;
  const run = (args: readonly string[]) => {
    calls.push([...args]);
    const q = queues.get(args[0] === "do" ? (args[1] ?? "") : (args[0] ?? ""));
    const reply = (q && q.length > 1 ? q.shift() : q?.[0]) ?? "";
    return reply.startsWith("ERR ") ? Promise.reject(new Error(reply.slice(4))) : Promise.resolve(reply);
  };
  const ws = new HerdrAppWorkspace(run, BRIGADE, {
    sleep: (ms) => ((clock += ms), Promise.resolve()),
    now: () => clock,
  });
  return { ws, calls };
}

describe("HerdrAppWorkspace.open", () => {
  it("makes the space, keeps the terminal as a tab, moves it first, then closes the shell tab", async () => {
    const shellOnly = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-shell", terminals: ["t20"] }]);
    const both = space("sp-b", "Brigade", "/state/coordinator", [
      { id: "tb-shell", terminals: ["t20"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({
      ls: [ls(work), ls(work, shellOnly), ls(work, both)],
      "space.new": '{"space":"sp-b","tab":"tb-shell","terminal":"t20"}',
      "terminal.keep": '{"pending":true,"terminal":"t5","pane":"p-t5","tab":"tb-c"}',
    });
    await ws.open("t5", { first: true });
    expect(calls).toEqual([
      ["ls"],
      ["do", "space.new", "--name", "Brigade", "--folder", "/state/coordinator"],
      ["do", "terminal.keep", "--terminal", "t5", "--place", "tab"],
      ["ls"],
      ["ls"],
      ["do", "tab.move", "--id", "tb-c", "--index", "1"],
      ["do", "tab.close", "--id", "tb-shell", "--confirmed", "true"],
    ]);
  });

  it("uses the Brigade space that is there, and moves nothing without first", async () => {
    const before = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-c", terminals: ["t5"] }]);
    const after = space("sp-b", "Brigade", "/state/coordinator", [
      { id: "tb-c", terminals: ["t5"] },
      { id: "tb-k", terminals: ["t6"] },
    ]);
    const { ws, calls } = workspace({
      ls: [ls(work, before), ls(work, after)],
      "terminal.keep": '{"terminal":"t6","tab":"tb-k"}',
    });
    await ws.open("t6", { first: false });
    expect(calls).toEqual([
      ["ls"],
      ["do", "space.select", "--id", "sp-b"],
      ["do", "terminal.keep", "--terminal", "t6", "--place", "tab"],
      ["ls"],
    ]);
  });

  it("moves a kept tab that is already first nowhere", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const after = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-c", terminals: ["t5"] }]);
    const { ws, calls } = workspace({ ls: [ls(empty), ls(after)], "terminal.keep": '{"tab":"tb-c"}' });
    await ws.open("t5", { first: true });
    expect(calls.map((c) => c[1] ?? c[0])).toEqual(["ls", "space.select", "terminal.keep", "ls"]);
  });

  it("shows a tab that is there, and moves it first only in the Brigade space", async () => {
    const brigade = space("sp-b", "Brigade", "/state/coordinator", [
      { id: "tb-a", terminals: ["t7"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({ ls: ls(work, brigade) });
    await ws.open("t5", { first: true });
    expect(calls).toEqual([
      ["ls"],
      ["do", "tab.move", "--id", "tb-c", "--index", "1"],
      ["do", "space.select", "--id", "sp-b"],
      ["do", "tab.select", "--id", "tb-c"],
    ]);
  });

  it("shows a tab in the owner's space where it is, even with first", async () => {
    const owners = space("sp-work", "Work", "/home/sam/shop", [
      { id: "tb-w1", terminals: ["t1"] },
      { id: "tb-w2", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({ ls: ls(owners) });
    await ws.open("t5", { first: true });
    expect(calls).toEqual([["ls"], ["do", "space.select", "--id", "sp-work"], ["do", "tab.select", "--id", "tb-w2"]]);
  });

  it("leaves an owner's space named Brigade in another folder alone", async () => {
    const owners = space("sp-o", "Brigade", "/home/sam/notes", [{ id: "tb-o", terminals: ["t2"] }]);
    const made = space("sp-b", "Brigade", "/state/coordinator", [
      { id: "tb-shell", terminals: ["t20"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({
      ls: [ls(owners), ls(owners, made)],
      "space.new": '{"space":"sp-b","tab":"tb-shell"}',
      "terminal.keep": '{"tab":"tb-c"}',
    });
    await ws.open("t5", { first: false });
    expect(calls[1]).toEqual(["do", "space.new", "--name", "Brigade", "--folder", "/state/coordinator"]);
    expect(calls.at(-1)).toEqual(["do", "tab.close", "--id", "tb-shell", "--confirmed", "true"]);
  });

  it("fails and moves nothing when the tab lands in another space", async () => {
    const brigade = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-shell", terminals: ["t20"] }]);
    const elsewhere = space("sp-work", "Work", "/home/sam/shop", [{ id: "tb-c", terminals: ["t5"] }]);
    const { ws, calls } = workspace({
      ls: [ls(work), ls(elsewhere, brigade)],
      "space.new": '{"space":"sp-b","tab":"tb-shell"}',
      "terminal.keep": '{"tab":"tb-c"}',
    });
    await expect(ws.open("t5", { first: true })).rejects.toThrow(
      /^herdr-app put the tab for t5 in the space "Work", not in "Brigade"\. Brigade moved nothing\. Close that tab and try again\.$/,
    );
    expect(calls.map((c) => c[1] ?? c[0])).toEqual(["ls", "space.new", "terminal.keep", "ls"]);
  });

  it("keeps the terminal again while herdr-app has not seen it yet", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const after = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-c", terminals: ["t5"] }]);
    const notYet = 'ERR herdr-app do terminal.keep failed: { "error": "no running terminal \\"t5\\"" }';
    const { ws, calls } = workspace({ ls: [ls(empty), ls(after)], "terminal.keep": [notYet, '{"tab":"tb-c"}'] });
    await ws.open("t5", { first: false });
    expect(calls.filter((c) => c[1] === "terminal.keep")).toHaveLength(2);
  });

  it("gives up after 10 seconds when ls never lists the new tab", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const { ws, calls } = workspace({ ls: ls(empty), "terminal.keep": '{"tab":"tb-c"}' });
    await expect(ws.open("t5", { first: false })).rejects.toThrow(/^herdr-app does not list the new tab tb-c$/);
    expect(calls.filter((c) => c[0] === "ls")).toHaveLength(22);
  });

  it("fails on answers it cannot read", async () => {
    await expect(workspace({ ls: "{}" }).ws.open("t5", { first: false })).rejects.toThrow(
      /^herdr-app ls returned no spaces$/,
    );
    await expect(workspace({ ls: "null" }).ws.open("t5", { first: false })).rejects.toThrow(
      /^herdr-app ls returned no object$/,
    );
    await expect(workspace({ ls: ls(work), "space.new": "{}" }).ws.open("t5", { first: false })).rejects.toThrow(
      /^herdr-app space.new returned no space$/,
    );
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    await expect(
      workspace({ ls: ls(empty), "terminal.keep": '{"pending":true}' }).ws.open("t5", { first: false }),
    ).rejects.toThrow(/^herdr-app terminal.keep returned no tab for t5$/);
  });
});

describe("HerdrAppWorkspace.check", () => {
  it("asks herdr-app for its status", async () => {
    const { ws, calls } = workspace({ status: '{"zoom":1.0}' });
    await ws.check();
    expect(calls).toEqual([["status"]]);
  });

  it("says herdr-app is not running when status fails", async () => {
    const { ws } = workspace({ status: "ERR herdr-app status failed: no window" });
    await expect(ws.check()).rejects.toThrow(
      /^herdr-app is not running\. Open it, then try again\. \(herdr-app status failed: no window\)$/,
    );
  });
});
