import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HerdrApp, installMod } from "./herdrApp.ts";

describe("HerdrApp", () => {
  it("focuses an agent, toggles the panel and checks a mod with herdr-app's own commands", async () => {
    const calls: string[][] = [];
    const app = new HerdrApp((args) => {
      calls.push([...args]);
      return Promise.resolve(args[0] === "check" ? "check passed: /m\n" : '{"ok":true}');
    });
    await app.focus("t7");
    await app.openPanel();
    expect(await app.check("/m")).toBe("check passed: /m");
    expect(calls).toEqual([
      ["do", "agent.focus", "--terminal", "t7"],
      ["do", "mod.open", "--name", "brigade"],
      ["check", "/m"],
    ]);
  });
});

describe("installMod", () => {
  it("copies the mod's files into mods/brigade and writes its state folder into config.js", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "brigade-mod-src-"));
    for (const f of ["main.js", "model.js", "mod.json", "brigade.svg", "model.test.js"])
      await writeFile(path.join(source, f), f);
    const home = await mkdtemp(path.join(tmpdir(), "brigade-herdr-home-"));
    const target = await installMod(source, home, '/state/with "quotes"');
    expect(target).toBe(path.join(home, "mods", "brigade"));
    expect((await readdir(target)).sort()).toEqual(["brigade.svg", "config.js", "main.js", "mod.json", "model.js"]);
    expect(await readFile(path.join(target, "config.js"), "utf8")).toBe(
      '// Written by "brigade mod install"; run it again to change.\nexport const STATE_DIR = "/state/with \\"quotes\\"";\n',
    );
  });
});
