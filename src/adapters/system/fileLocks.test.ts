import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileLocks } from "./fileLocks.ts";

const temp = () => mkdtemp(path.join(tmpdir(), "brigade-locks-"));

describe("FileLocks", () => {
  it("runs one holder at a time, also across lock objects, and removes the lock after", async () => {
    const folder = path.join(await temp(), "locks");
    const [a, b] = [new FileLocks(folder, { retryMs: 1 }), new FileLocks(folder, { retryMs: 1 })];
    const order: string[] = [];
    const hold = (who: string) => async () => {
      order.push(`${who} in`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${who} out`);
      return who;
    };
    expect(await Promise.all([a.withLock("task-1", hold("a")), b.withLock("task-1", hold("b"))])).toEqual(["a", "b"]);
    expect(order).toEqual(["a in", "a out", "b in", "b out"]);
    order.length = 0;
    expect(await Promise.all([a.withLock("task-1", hold("c")), a.withLock("task-1", hold("d"))])).toEqual(["c", "d"]);
    expect(order).toEqual(["c in", "c out", "d in", "d out"]);
    expect(await readdir(folder)).toEqual([]);
  });

  it("lets different names run at once", async () => {
    const locks = new FileLocks(path.join(await temp(), "locks"));
    let inside = 0;
    let most = 0;
    const hold = async () => {
      most = Math.max(most, ++inside);
      await new Promise((r) => setTimeout(r, 20));
      inside--;
    };
    await Promise.all([locks.withLock("task-1", hold), locks.withLock("task-2", hold)]);
    expect(most).toBe(2);
  });

  it("releases the lock when the work fails", async () => {
    const folder = path.join(await temp(), "locks");
    const locks = new FileLocks(folder);
    await expect(locks.withLock("task-1", () => Promise.reject(new Error("boom")))).rejects.toThrow(/^boom$/);
    expect(await locks.withLock("task-1", () => Promise.resolve("again"))).toBe("again");
  });

  it("gives up after waitMs on a fresh lock, and takes over a stale one", async () => {
    const folder = await temp();
    let clock = 1_000;
    const options = {
      waitMs: 100,
      staleMs: 500,
      retryMs: 10,
      now: () => clock,
      sleep: (ms: number) => ((clock += ms), Promise.resolve()),
    };
    await writeFile(path.join(folder, "task-1.lock"), `999 ${clock} abc\n`);
    await expect(new FileLocks(folder, options).withLock("task-1", () => Promise.resolve())).rejects.toThrow(
      /^Another brigade process holds "task-1"\. Try again in a minute\.$/,
    );
    clock += 1_000;
    expect(await new FileLocks(folder, options).withLock("task-1", () => Promise.resolve("taken"))).toBe("taken");
  });

  it("refuses a name that is not a plain word", async () => {
    await expect(new FileLocks("/x").withLock("../etc", () => Promise.resolve())).rejects.toThrow(
      /^Bad lock name "\.\.\/etc"\.$/,
    );
  });
});
