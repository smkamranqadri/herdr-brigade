import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locks } from "../../application/ports.ts";
import { BrigadeError, errorCode } from "../../domain/errors.ts";

export interface FileLockOptions {
  /** How long a caller waits for a lock before it gives up. */
  readonly waitMs: number;
  /** A lock older than this is taken over: its holder is gone or stuck. */
  readonly staleMs: number;
  readonly retryMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** A worker resume holds its lock through the start and the ready wait: well under a minute. */
const DEFAULTS: FileLockOptions = {
  waitMs: 90_000,
  staleMs: 120_000,
  retryMs: 250,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Locks as files in one folder, shared by every brigade process: `<folder>/<name>.lock`, made with an exclusive
 * create. Its content names the holder and the time, so a lock left by a crash is taken over once it is stale.
 */
export class FileLocks implements Locks {
  private readonly folder: string;
  private readonly options: FileLockOptions;
  constructor(folder: string, options: Partial<FileLockOptions> = {}) {
    this.folder = folder;
    this.options = { ...DEFAULTS, ...options };
  }

  async withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new BrigadeError(`Bad lock name "${name}".`);
    return this.held(name, work);
  }

  private async held<T>(name: string, work: () => Promise<T>): Promise<T> {
    const file = path.join(this.folder, `${name}.lock`);
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const { waitMs, retryMs, now, sleep } = this.options;
    const until = now() + waitMs;
    let mine: string | null;
    while ((mine = await this.tryLock(file)) === null) {
      if (now() >= until) throw new BrigadeError(`Another brigade process holds "${name}". Try again in a minute.`);
      await sleep(retryMs);
    }
    try {
      return await work();
    } finally {
      await removeIfStill(file, mine).catch(() => undefined);
    }
  }

  /** Takes the lock if it is free, or takes over a stale one. Returns its content when taken. */
  private async tryLock(file: string): Promise<string | null> {
    const mine = `${process.pid} ${this.options.now()} ${randomBytes(6).toString("hex")}\n`;
    try {
      await writeFile(file, mine, { flag: "wx", mode: 0o600 });
      return mine;
    } catch (err) {
      if (errorCode(err) !== "EEXIST") throw err;
    }
    const seen = await readFile(file, "utf8").catch(() => null);
    if (seen !== null && (await this.isStale(file, seen))) await removeIfStill(file, seen);
    return null;
  }

  /** Its age comes from the time written in it, or from the file's own time if the content is unreadable. */
  private async isStale(file: string, content: string): Promise<boolean> {
    const written = Number(content.split(" ")[1]);
    const since = Number.isFinite(written)
      ? written
      : await stat(file).then(
          (s) => s.mtimeMs,
          () => null,
        );
    return since !== null && this.options.now() - since > this.options.staleMs;
  }
}

/** Removes the lock only if it still holds `expected`; one another process took since is put back. */
async function removeIfStill(file: string, expected: string): Promise<void> {
  const aside = `${file}.${randomBytes(6).toString("hex")}.gone`;
  try {
    await rename(file, aside);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return;
    throw err;
  }
  // A link fails when a new lock is there already, so the put-back never replaces one.
  if ((await readFile(aside, "utf8")) !== expected) await link(aside, file).catch(() => undefined);
  await unlink(aside);
}
