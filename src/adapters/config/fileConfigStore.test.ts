import { mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withProject, type BrigadeConfig } from "../../domain/config.ts";
import { FileConfigStore, removeIfStill } from "./fileConfigStore.ts";

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

  it("takes over a lock older than 30 seconds, and leaves no lock or temp file behind", async () => {
    const file = await configFile();
    await writeFile(`${file}.lock`, "999999 0\n");
    const store = new FileConfigStore(file, { now: () => 30_001 });
    await store.update(add("one"));
    expect((await store.read()).projects.map((p) => p.name)).toEqual(["one"]);
    expect(await readdir(path.dirname(file))).toEqual(["config.json"]);
  });

  it("takes over an empty lock (a crash while it was written) once the file is old", async () => {
    const file = await configFile();
    await writeFile(`${file}.lock`, "");
    await utimes(`${file}.lock`, 0, 0);
    await new FileConfigStore(file).update(add("one"));
    expect((await new FileConfigStore(file).read()).projects.map((p) => p.name)).toEqual(["one"]);
  });

  it("a late reaper never deletes the lock another writer took in the meantime", async () => {
    const file = await configFile();
    await writeFile(`${file}.lock`, "222 50000 b\n");
    await removeIfStill(`${file}.lock`, "111 0 a\n");
    expect(await readFile(`${file}.lock`, "utf8")).toBe("222 50000 b\n");
    expect((await readdir(path.dirname(file))).sort()).toEqual(["config.json", "config.json.lock"]);
  });

  it("drops a slow writer's change once its lock has passed to another writer", async () => {
    const file = await configFile();
    const lock = `${file}.lock`;
    const store = new FileConfigStore(file);
    const slow = (c: BrigadeConfig) => (writeFileSync(lock, "333 1 other\n"), withProject(c, project("late")));
    await expect(store.update(slow)).rejects.toThrow("The config changed hands while this write was slow. Try again.");
    expect((await store.read()).projects).toEqual([]);
    expect(await readFile(lock, "utf8")).toBe("333 1 other\n");
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
