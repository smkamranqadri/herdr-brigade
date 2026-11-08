import { randomBytes } from "node:crypto";
import { link, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { ConfigStore } from "../../application/ports.ts";
import { checkedChange, parseConfig, type BrigadeConfig } from "../../domain/config.ts";
import { BrigadeError, errorCode } from "../../domain/errors.ts";

export interface LockOptions {
  /** How long a writer waits for the lock before it gives up. */
  readonly waitMs: number;
  /** A lock older than this is taken over: a writer holds it for milliseconds, so its holder is gone or stuck. */
  readonly staleMs: number;
  readonly retryMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const DEFAULTS: LockOptions = {
  waitMs: 5_000,
  staleMs: 30_000,
  retryMs: 50,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const unique = (file: string, kind: string) => `${file}.${randomBytes(6).toString("hex")}.${kind}`;

/**
 * Removes the file only if it still holds `expected`. It is moved aside first, so a lock that another writer put
 * there since `expected` was read is put back, never deleted.
 */
export async function removeIfStill(file: string, expected: string): Promise<void> {
  const aside = unique(file, "gone");
  try {
    await rename(file, aside);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return;
    throw err;
  }
  if ((await readFile(aside, "utf8")) !== expected) await link(aside, file).catch(() => undefined);
  await unlink(aside);
}

/**
 * brigade's config.json. Writes from any number of processes go one at a time: each takes `<file>.lock` for its
 * whole read, check, write and rename, so no write is lost and none lands half-done. The lock is created with its
 * content in one step (a hard link), so a crash never leaves an empty lock. A hand edit doesn't take the lock, so the
 * owner edits only while no brigade agent runs.
 */
export class FileConfigStore implements ConfigStore {
  private readonly file: string;
  private readonly lock: string;
  private readonly options: LockOptions;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string, options: Partial<LockOptions> = {}) {
    this.file = file;
    this.lock = `${file}.lock`;
    this.options = { ...DEFAULTS, ...options };
  }

  async read(): Promise<BrigadeConfig> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.file, "utf8"));
    } catch (err) {
      if (errorCode(err) === "ENOENT") throw new BrigadeError(`No config at ${this.file}. Run "brigade init" first.`);
      throw new BrigadeError(`Can't read ${this.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = parseConfig(raw);
    if (!parsed.ok) throw new BrigadeError(`${this.file} has problems:\n- ${parsed.errors.join("\n- ")}`);
    return parsed.value;
  }

  update(change: (config: BrigadeConfig) => BrigadeConfig): Promise<BrigadeConfig> {
    // One at a time inside this process too, so two tool calls never race for the lock file.
    const run = this.queue.then(() => this.withLock((mine) => this.apply(change, mine)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(change: (config: BrigadeConfig) => BrigadeConfig, mine: string): Promise<BrigadeConfig> {
    const { config, json } = checkedChange(await this.read(), change);
    const tmp = unique(this.file, "tmp");
    const { mode } = await stat(this.file);
    await writeFile(tmp, JSON.stringify(json, null, 2) + "\n", { mode: mode & 0o777 });
    // A writer stuck past staleMs may have lost the lock to another; then its change must not land.
    if ((await readFile(this.lock, "utf8").catch(() => null)) !== mine) {
      await unlink(tmp);
      throw new BrigadeError("The config changed hands while this write was slow. Try again.");
    }
    await rename(tmp, this.file);
    return config;
  }

  private async withLock<T>(work: (mine: string) => Promise<T>): Promise<T> {
    const { waitMs, retryMs, now, sleep } = this.options;
    const until = now() + waitMs;
    let mine: string | null;
    while ((mine = await this.tryLock()) === null) {
      if (now() >= until)
        throw new BrigadeError("The config is busy: another brigade process is writing it. Try again.");
      await sleep(retryMs);
    }
    try {
      return await work(mine);
    } finally {
      await removeIfStill(this.lock, mine).catch(() => undefined);
    }
  }

  /** Takes the lock if it is free, or takes over one older than staleMs. Returns the lock's content when taken. */
  private async tryLock(): Promise<string | null> {
    const mine = `${process.pid} ${this.options.now()} ${randomBytes(6).toString("hex")}\n`;
    const tmp = unique(this.lock, "tmp");
    await writeFile(tmp, mine);
    try {
      await link(tmp, this.lock);
      return mine;
    } catch (err) {
      if (errorCode(err) !== "EEXIST") throw err;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    const seen = await readFile(this.lock, "utf8").catch(() => null);
    if (seen !== null && (await this.isStale(seen))) await removeIfStill(this.lock, seen);
    return null;
  }

  /** Its age comes from the time written in it, or from the file's own time if the content is unreadable. */
  private async isStale(content: string): Promise<boolean> {
    const written = Number(content.split(" ")[1]);
    const since = Number.isFinite(written)
      ? written
      : await stat(this.lock).then(
          (s) => s.mtimeMs,
          () => null,
        );
    return since !== null && this.options.now() - since > this.options.staleMs;
  }
}
