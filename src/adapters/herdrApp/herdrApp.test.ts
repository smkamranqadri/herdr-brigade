import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HerdrApp, HerdrAppWorkspace, installMod } from "./herdrApp.ts";

describe("HerdrApp", () => {
  it("toggles the panel and checks a mod with herdr-app's own commands", async () => {
    const calls: string[][] = [];
    const app = new HerdrApp((args) => {
      calls.push([...args]);
      return Promise.resolve(args[0] === "check" ? "check passed: /m\n" : '{"ok":true}');
    });
    await app.openPanel();
    expect(await app.check("/m")).toBe("check passed: /m");
    expect(calls).toEqual([
      ["do", "mod.open", "--name", "brigade"],
      ["check", "/m"],
    ]);
  });
});

describe("installMod", () => {
  it("copies the mod's files into mods/brigade and writes its state folder into config.js", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "brigade-mod-src-"));
    for (const f of ["main.js", "model.js", "mod.json", "brigade.svg", "panel.svg", "model.test.js"])
      await writeFile(path.join(source, f), f);
    const home = await mkdtemp(path.join(tmpdir(), "brigade-herdr-home-"));
    const brigade = ["env", "BRIGADE_STATE=/s", "/bin/node", "/app/cli.ts"];
    const target = await installMod(source, home, {
      stateDir: '/state/with "quotes"',
      configFile: "/c/config.json",
      start: [...brigade, "start"],
      open: [...brigade, "open"],
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
        "// A click on the Coordinator or a Captain runs this with the terminal's address: `brigade open <address>`.",
        'export const OPEN = ["env","BRIGADE_STATE=/s","/bin/node","/app/cli.ts","open"];',
        "",
      ].join("\n"),
    );
  });

  it("copies main.js last, so herdr-app reloads the mod with the new config.js", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "brigade-mod-src-"));
    for (const f of ["main.js", "model.js", "mod.json", "brigade.svg", "panel.svg"])
      await writeFile(path.join(source, f), f);
    const home = await mkdtemp(path.join(tmpdir(), "brigade-herdr-home-"));
    const target = path.join(home, "mods", "brigade");
    // A folder named main.js makes its copy fail, so the files written before it stay.
    await mkdir(path.join(target, "main.js"), { recursive: true });
    const where = { stateDir: "/s", configFile: "/c", start: ["start"], open: ["open"] };
    await expect(installMod(source, home, where)).rejects.toThrow();
    expect((await readdir(target)).sort()).toEqual([
      "brigade.svg",
      "config.js",
      "main.js",
      "mod.json",
      "model.js",
      "panel.svg",
    ]);
  });
});

// `herdr-app ls` as it printed on 2026-11-11 (herdr-app 0.1.15), with made-up ids and folders.
interface TabSpec {
  readonly id: string;
  readonly terminals: readonly string[];
  /** The space's shown tab. */
  readonly active?: boolean;
}
const space = (id: string, name: string, folder: string, tabs: readonly TabSpec[], shown = false) => ({
  id,
  name,
  folder,
  machine: null,
  active: shown,
  tabs: tabs.map((t, i) => ({
    id: t.id,
    name: String(i + 1),
    active: t.active ?? false,
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
/** Options for the Brigade space, without returning to the owner's view. */
const inBrigade = (first: boolean) => ({ place: BRIGADE, first, returnToView: false });
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
  const ws = new HerdrAppWorkspace(run, {
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
    await ws.open("t5", inBrigade(true));
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
    await ws.open("t6", inBrigade(false));
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
    await ws.open("t5", inBrigade(true));
    expect(calls.map((c) => c[1] ?? c[0])).toEqual(["ls", "space.select", "terminal.keep", "ls"]);
  });

  it("shows a tab that is there, and moves it first only in the Brigade space", async () => {
    const brigade = space("sp-b", "Brigade", "/state/coordinator", [
      { id: "tb-a", terminals: ["t7"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({ ls: ls(work, brigade) });
    await ws.open("t5", inBrigade(true));
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
    await ws.open("t5", inBrigade(true));
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
    await ws.open("t5", inBrigade(false));
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
    await expect(ws.open("t5", inBrigade(true))).rejects.toThrow(
      /^herdr-app put the tab for t5 in the space "Work", not in "Brigade"\. Brigade moved nothing\. Close that tab and try again\.$/,
    );
    expect(calls.map((c) => c[1] ?? c[0])).toEqual(["ls", "space.new", "terminal.keep", "ls"]);
  });

  it("keeps the terminal again while herdr-app has not seen it yet", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const after = space("sp-b", "Brigade", "/state/coordinator", [{ id: "tb-c", terminals: ["t5"] }]);
    const notYet = 'ERR herdr-app do terminal.keep failed: { "error": "no running terminal \\"t5\\"" }';
    const { ws, calls } = workspace({ ls: [ls(empty), ls(after)], "terminal.keep": [notYet, '{"tab":"tb-c"}'] });
    await ws.open("t5", inBrigade(false));
    expect(calls.filter((c) => c[1] === "terminal.keep")).toHaveLength(2);
  });

  it("fails at once on another keep error, and after 10 seconds of not seeing the terminal", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const broken = workspace({ ls: ls(empty), "terminal.keep": "ERR herdr-app do terminal.keep failed: no window" });
    await expect(broken.ws.open("t5", inBrigade(false))).rejects.toThrow(/no window$/);
    expect(broken.calls.filter((c) => c[1] === "terminal.keep")).toHaveLength(1);
    const notYet = 'ERR herdr-app do terminal.keep failed: { "error": "no running terminal \\"t5\\"" }';
    const slow = workspace({ ls: ls(empty), "terminal.keep": notYet });
    await expect(slow.ws.open("t5", inBrigade(false))).rejects.toThrow("no running terminal");
    expect(slow.calls.filter((c) => c[1] === "terminal.keep")).toHaveLength(21);
  });

  it("gives up after 10 seconds when ls never lists the new tab", async () => {
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    const { ws, calls } = workspace({ ls: ls(empty), "terminal.keep": '{"tab":"tb-c"}' });
    await expect(ws.open("t5", inBrigade(false))).rejects.toThrow(/^herdr-app does not list the new tab tb-c$/);
    expect(calls.filter((c) => c[0] === "ls")).toHaveLength(22);
  });

  it("fails on answers it cannot read", async () => {
    await expect(workspace({ ls: "{}" }).ws.open("t5", inBrigade(false))).rejects.toThrow(
      /^herdr-app ls returned no spaces$/,
    );
    await expect(workspace({ ls: "null" }).ws.open("t5", inBrigade(false))).rejects.toThrow(
      /^herdr-app ls returned no object$/,
    );
    await expect(workspace({ ls: ls(work), "space.new": "{}" }).ws.open("t5", inBrigade(false))).rejects.toThrow(
      /^herdr-app space.new returned no space$/,
    );
    const empty = space("sp-b", "Brigade", "/state/coordinator", []);
    await expect(
      workspace({ ls: ls(empty), "terminal.keep": '{"pending":true}' }).ws.open("t5", inBrigade(false)),
    ).rejects.toThrow(/^herdr-app terminal.keep returned no tab for t5$/);
  });
});

const SHOP = { name: "shop", folder: "/repos/shop" };
/** The owner's view: space sp-o, its tab tb-o shown. */
const owners = space("sp-o", "Notes", "/home/sam/notes", [{ id: "tb-o", terminals: ["t1"], active: true }], true);

describe("HerdrAppWorkspace.open in a project's space", () => {
  it("uses the first space whose folder is the repo, whatever its name", async () => {
    const first = space("sp-1", "Work", "/repos/shop", [{ id: "tb-1", terminals: ["t2"] }]);
    const second = space("sp-2", "shop", "/repos/shop", [{ id: "tb-2", terminals: ["t3"] }]);
    const sub = space("sp-0", "shop", "/repos/shop/web", [{ id: "tb-0", terminals: ["t4"] }]);
    const after = space("sp-1", "Work", "/repos/shop", [
      { id: "tb-1", terminals: ["t2"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({
      ls: [ls(sub, first, second), ls(sub, after, second)],
      "terminal.keep": '{"tab":"tb-c"}',
    });
    await ws.open("t5", { place: SHOP, first: false, returnToView: false });
    expect(calls.slice(0, 2)).toEqual([["ls"], ["do", "space.select", "--id", "sp-1"]]);
  });

  it("makes a space named after the project when no space has the repo folder", async () => {
    const made = space("sp-s", "shop", "/repos/shop", [
      { id: "tb-shell", terminals: ["t20"] },
      { id: "tb-c", terminals: ["t5"] },
    ]);
    const { ws, calls } = workspace({
      ls: [ls(owners), ls(owners, made)],
      "space.new": '{"space":"sp-s","tab":"tb-shell"}',
      "terminal.keep": '{"tab":"tb-c"}',
    });
    await ws.open("t5", { place: SHOP, first: false, returnToView: false });
    expect(calls[1]).toEqual(["do", "space.new", "--name", "shop", "--folder", "/repos/shop"]);
  });
});

describe("HerdrAppWorkspace.open with returnToView", () => {
  const shop = space("sp-s", "shop", "/repos/shop", [{ id: "tb-x", terminals: ["t9"] }]);
  const placed = space("sp-s", "shop", "/repos/shop", [
    { id: "tb-x", terminals: ["t9"] },
    { id: "tb-c", terminals: ["t5"] },
  ]);
  const back = { place: SHOP, first: false, returnToView: true };

  it("shows the owner's earlier tab again after making the tab", async () => {
    const { ws, calls } = workspace({ ls: [ls(owners, shop), ls(owners, placed)], "terminal.keep": '{"tab":"tb-c"}' });
    await ws.open("t5", back);
    expect(calls).toEqual([
      ["ls"],
      ["do", "space.select", "--id", "sp-s"],
      ["do", "terminal.keep", "--terminal", "t5", "--place", "tab"],
      ["ls"],
      ["do", "tab.select", "--id", "tb-o"],
    ]);
  });

  it("shows the owner's view again after a failure, and throws the first error as it is", async () => {
    const { ws, calls } = workspace({
      ls: ls(owners, shop),
      "terminal.keep": "ERR herdr-app do terminal.keep failed: no window",
    });
    await expect(ws.open("t5", back)).rejects.toThrow(/^herdr-app do terminal\.keep failed: no window$/);
    expect(calls.at(-1)).toEqual(["do", "tab.select", "--id", "tb-o"]);
  });

  it("shows the earlier space when its tab has gone, and nothing when the space has gone too", async () => {
    const tabGone = 'ERR herdr-app do tab.select failed: { "error": "no such tab" }';
    const spaceGone = 'ERR herdr-app do space.select failed: { "error": "no such space" }';
    const one = workspace({
      ls: [ls(owners, shop), ls(owners, placed)],
      "terminal.keep": '{"tab":"tb-c"}',
      "tab.select": tabGone,
    });
    await one.ws.open("t5", back);
    expect(one.calls.at(-1)).toEqual(["do", "space.select", "--id", "sp-o"]);
    const both = workspace({
      ls: [ls(owners, shop), ls(owners, placed)],
      "terminal.keep": '{"tab":"tb-c"}',
      "tab.select": tabGone,
      "space.select": ["", spaceGone],
    });
    await both.ws.open("t5", back);
    expect(both.calls.slice(-2)).toEqual([
      ["do", "tab.select", "--id", "tb-o"],
      ["do", "space.select", "--id", "sp-o"],
    ]);
  });

  it("reports a failure to restore, alone or after the first error", async () => {
    const stuck = "ERR herdr-app do tab.select failed: window busy";
    const ok = workspace({
      ls: [ls(owners, shop), ls(owners, placed)],
      "terminal.keep": '{"tab":"tb-c"}',
      "tab.select": stuck,
    });
    await expect(ok.ws.open("t5", back)).rejects.toThrow(
      /^Brigade could not show your earlier tab again: herdr-app do tab\.select failed: window busy$/,
    );
    const failed = workspace({
      ls: ls(owners, shop),
      "terminal.keep": "ERR herdr-app do terminal.keep failed: no window",
      "tab.select": stuck,
    });
    await expect(failed.ws.open("t5", back)).rejects.toThrow(
      /^herdr-app do terminal\.keep failed: no window\nBrigade could not show your earlier tab again: herdr-app do tab\.select failed: window busy$/,
    );
  });

  it("stays on the new tab without returnToView", async () => {
    const { ws, calls } = workspace({ ls: [ls(owners, shop), ls(owners, placed)], "terminal.keep": '{"tab":"tb-c"}' });
    await ws.open("t5", { ...back, returnToView: false });
    expect(calls.at(-1)).toEqual(["ls"]);
  });

  it("restores nothing when no space is shown", async () => {
    const { ws, calls } = workspace({ ls: [ls(shop), ls(placed)], "terminal.keep": '{"tab":"tb-c"}' });
    await ws.open("t5", back);
    expect(calls.at(-1)).toEqual(["ls"]);
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
