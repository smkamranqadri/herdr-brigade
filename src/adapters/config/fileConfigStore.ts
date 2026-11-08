import { randomBytes } from "node:crypto";
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { ConfigStore } from "../../application/ports.ts";
import { parseConfig, serializeConfig, type BrigadeConfig } from "../../domain/config.ts";
import { BrigadeError, errorCode } from "../../domain/errors.ts";

export interface LockOptions {
  /** How long a writer waits for the lock before it gives up. */
  readonly waitMs: number;
  /** A lock this old whose process is gone is taken over. */
  readonly staleMs: number;
  readonly retryMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly isAlive: (pid: number) => boolean;
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === "EPERM";
  }
};

const DEFAULTS: LockOptions = {
  waitMs: 5_000,
  staleMs: 30_000,
  retryMs: 50,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  isAlive: pidAlive,
};

/**
 * brigade's config.json. Writes from any number of processes go one at a time: each takes `<file>.lock`
 * (created exclusively) for its whole read, check, write and rename, so no write is lost and none lands half-done.
 * A hand edit doesn't take the lock, so the owner edits only while no brigade agent runs.
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
    const run = this.queue.then(() => this.withLock(() => this.apply(change)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(change: (config: BrigadeConfig) => BrigadeConfig): Promise<BrigadeConfig> {
    const json = serializeConfig(change(await this.read()));
    const parsed = parseConfig(json);
    if (!parsed.ok) throw new BrigadeError(`That change would break the config:\n- ${parsed.errors.join("\n- ")}`);
    const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
    const { mode } = await stat(this.file);
    await writeFile(tmp, JSON.stringify(json, null, 2) + "\n", { mode: mode & 0o777 });
    await rename(tmp, this.file);
    return parsed.value;
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const { waitMs, retryMs, now, sleep } = this.options;
    const until = now() + waitMs;
    while (!(await this.tryLock())) {
      if (now() >= until)
        throw new BrigadeError("The config is busy: another brigade process is writing it. Try again.");
      await sleep(retryMs);
    }
    try {
      return await work();
    } finally {
      await unlink(this.lock).catch(() => undefined);
    }
  }

  /** Takes the lock if it is free, or if its holder is gone and it is old. */
  private async tryLock(): Promise<boolean> {
    try {
      const handle = await open(this.lock, "wx");
      await handle.writeFile(`${process.pid} ${this.options.now()}\n`);
      await handle.close();
      return true;
    } catch (err) {
      if (errorCode(err) !== "EEXIST") throw err;
    }
    const [pidText, atText] = (await readFile(this.lock, "utf8").catch(() => "")).trim().split(" ");
    const pid = Number(pidText);
    const stale = this.options.now() - Number(atText) > this.options.staleMs && !this.options.isAlive(pid);
    if (stale) await unlink(this.lock).catch(() => undefined);
    return false;
  }
}
