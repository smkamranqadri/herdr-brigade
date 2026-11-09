import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HerdrApp, installMod } from "./herdrApp.ts";

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
    for (const f of ["main.js", "model.js", "mod.json", "brigade.svg", "model.test.js"])
      await writeFile(path.join(source, f), f);
    const home = await mkdtemp(path.join(tmpdir(), "brigade-herdr-home-"));
    const target = await installMod(source, home, { stateDir: '/state/with "quotes"', configFile: "/c/config.json" });
    expect(target).toBe(path.join(home, "mods", "brigade"));
    expect((await readdir(target)).sort()).toEqual(["brigade.svg", "config.js", "main.js", "mod.json", "model.js"]);
    expect(await readFile(path.join(target, "config.js"), "utf8")).toBe(
      '// Written by "brigade mod install"; run it again to change.\nexport const STATE_DIR = "/state/with \\"quotes\\"";\nexport const CONFIG_FILE = "/c/config.json";\n',
    );
  });
});
