import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withProject, type BrigadeConfig } from "../../domain/config.ts";
import { FileConfigStore } from "./fileConfigStore.ts";

const spec = { harness: "claude", model: "m", effort: "low" } as const;
const START = { owner: "Sam", roles: { coordinator: spec, captain: spec, worker: spec }, projects: [] };
const project = (name: string) => ({ name, repo: `/repos/${name}`, baseBranch: "main", github: null });
const add = (name: string) => (c: BrigadeConfig) => withProject(c, project(name));

async function configFile(): Promise<string> {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "brigade-config-")), "config.json");
  await writeFile(file, JSON.stringify(START));
  return file;
}

describe("FileConfigStore", () => {
  it("keeps both changes when two stores (two processes) write at once", async () => {
    const file = await configFile();
    const [a, b] = [new FileConfigStore(file), new FileConfigStore(file)];
    await Promise.all([a.update(add("one")), b.update(add("two")), a.update(add("three")), b.update(add("four"))]);
    const names = (await a.read()).projects.map((p) => p.name).sort();
    expect(names).toEqual(["four", "one", "three", "two"]);
  });

  it("refuses a change that would break the config, and leaves the file as it was", async () => {
    const file = await configFile();
    const before = await readFile(file, "utf8");
    const store = new FileConfigStore(file);
    await expect(store.update((c) => ({ ...c, owner: "" }))).rejects.toThrow("That change would break the config");
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("takes over a stale lock whose process is gone", async () => {
    const file = await configFile();
    await writeFile(`${file}.lock`, "999999 0\n");
    const store = new FileConfigStore(file, { isAlive: () => false, now: () => 60_000 });
    await store.update(add("one"));
    expect((await store.read()).projects.map((p) => p.name)).toEqual(["one"]);
  });

  it("waits for a live lock and then gives up with a clear message", async () => {
    const file = await configFile();
    await writeFile(`${file}.lock`, `${process.pid} ${Date.now()}\n`);
    let clock = 0;
    const store = new FileConfigStore(file, { now: () => clock, sleep: (ms) => ((clock += ms), Promise.resolve()) });
    await expect(store.update(add("one"))).rejects.toThrow(
      "The config is busy: another brigade process is writing it. Try again.",
    );
    expect((await store.read()).projects).toEqual([]);
  });

  it("says how to start when there is no config", async () => {
    const missing = path.join(await mkdtemp(path.join(tmpdir(), "brigade-config-")), "config.json");
    await expect(new FileConfigStore(missing).read()).rejects.toThrow(
      `No config at ${missing}. Run "brigade init" first.`,
    );
  });
});
