// herdr-app, the Herdr window: the Brigade space and its tabs, the Brigade panel, and installing and checking the mod.
import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "../../application/ports.ts";
import { BrigadeError } from "../../domain/errors.ts";

/** Runs herdr-app with these arguments and returns what it printed. */
export type HerdrAppRunner = (args: readonly string[]) => Promise<string>;

const CALL_TIMEOUT_MS = 15_000;
const MOD_NAME = "brigade";
/** herdr-app learns of a new hc terminal a moment after it starts; until then it says this. */
const NOT_SEEN_YET = "no running terminal";
const FOCUS_WAIT_MS = 10_000;
const FOCUS_RETRY_MS = 500;
/** The mod's files, copied as they are. config.js is written by the install. */
const MOD_FILES = ["main.js", "model.js", "mod.json", "brigade.svg", "panel.svg"];

export function herdrAppRunner(bin: string): HerdrAppRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, [...args], { timeout: CALL_TIMEOUT_MS, encoding: "utf8" }, (err, stdout, stderr) => {
        if (err)
          reject(
            new Error(`herdr-app ${args.slice(0, 2).join(" ")} failed: ${(stdout + stderr).trim() || err.message}`),
          );
        else resolve(stdout);
      });
    });
}

export interface HerdrAppOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

interface Clocked {
  readonly run: HerdrAppRunner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

function clocked(run: HerdrAppRunner, options: HerdrAppOptions): Clocked {
  return {
    run,
    sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: options.now ?? Date.now,
  };
}

/** Runs a herdr-app command on a terminal, again while herdr-app has not seen that new terminal yet. */
async function untilSeen(c: Clocked, args: readonly string[]): Promise<string> {
  const until = c.now() + FOCUS_WAIT_MS;
  for (;;) {
    try {
      return await c.run(args);
    } catch (err) {
      const notSeenYet = err instanceof Error && err.message.includes(NOT_SEEN_YET);
      if (!notSeenYet || c.now() >= until) throw err;
      await c.sleep(FOCUS_RETRY_MS);
    }
  }
}

export class HerdrApp {
  private readonly c: Clocked;

  constructor(run: HerdrAppRunner, options: HerdrAppOptions = {}) {
    this.c = clocked(run, options);
  }

  /**
   * Shows the agent's terminal over the owner's tab (herdr-app's peek, with "keep" to make it a tab), so the owner can
   * type to it. agent.focus can't: brigade's agents run without a pane, so it has nothing to switch to. Waits while
   * herdr-app catches up with a new terminal.
   */
  async show(address: string): Promise<void> {
    await untilSeen(this.c, ["do", "terminal.peek", "--terminal", address]);
  }

  /** Opens (or closes) the Brigade panel as a window. */
  async openPanel(): Promise<void> {
    await this.c.run(["do", "mod.open", "--name", MOD_NAME]);
  }

  /** Loads the mod once and renders it; fails with herdr-app's exact error. */
  async check(modDir: string): Promise<string> {
    return (await this.c.run(["check", modDir])).trim();
  }
}

/** The space brigade makes and finds by both name and folder, so an owner's space of the same name is left alone. */
export interface BrigadeSpace {
  readonly name: string;
  readonly folder: string;
}

interface LsTab {
  readonly id: string;
  readonly terminals: readonly string[];
}

interface LsSpace {
  readonly id: string;
  readonly name: string;
  readonly folder: string | null;
  readonly tabs: readonly LsTab[];
}

/** A tab, its space, and its position there (1 = first). */
interface Place {
  readonly space: LsSpace;
  readonly tab: LsTab;
  readonly index: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);

function parseObject(out: string, what: string): Record<string, unknown> {
  const got: unknown = JSON.parse(out);
  if (!isObject(got)) throw new Error(`herdr-app ${what} returned no object`);
  return got;
}

/** `herdr-app ls`: spaces, their tabs, and the terminals in each tab. */
function parseLayout(out: string): LsSpace[] {
  const got = parseObject(out, "ls");
  if (!Array.isArray(got.spaces)) throw new Error("herdr-app ls returned no spaces");
  return objects(got.spaces).map((s) => ({
    id: text(s.id),
    name: text(s.name),
    folder: typeof s.folder === "string" ? s.folder : null,
    tabs: objects(s.tabs).map((t) => ({
      id: text(t.id),
      terminals: objects(t.terminals).map((x) => text(x.terminal)),
    })),
  }));
}

function findPlace(spaces: readonly LsSpace[], match: (tab: LsTab) => boolean): Place | null {
  for (const space of spaces) {
    for (const [i, tab] of space.tabs.entries()) if (match(tab)) return { space, tab, index: i + 1 };
  }
  return null;
}

/**
 * herdr-app as brigade's Workspace. A tab comes from terminal.keep, which needs a running terminal and puts the tab in
 * the shown space; probed on 2026-11-11 (docs/herdr-app.md).
 */
export class HerdrAppWorkspace implements Workspace {
  private readonly c: Clocked;
  private readonly space: BrigadeSpace;

  constructor(run: HerdrAppRunner, space: BrigadeSpace, options: HerdrAppOptions = {}) {
    this.c = clocked(run, options);
    this.space = space;
  }

  async check(): Promise<void> {
    try {
      await this.c.run(["status"]);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new BrigadeError(`herdr-app is not running. Open it, then try again. (${why})`);
    }
  }

  async open(address: string, { first }: { readonly first: boolean }): Promise<void> {
    const layout = await this.layout();
    const found = findPlace(layout, (t) => t.terminals.includes(address));
    if (found) return this.showFound(found, first);
    const { spaceId, shellTab } = await this.enterSpace(layout);
    const tab = await this.keep(address);
    const placed = await this.waitForTab(tab);
    if (placed.space.id !== spaceId)
      throw new BrigadeError(
        `herdr-app put the tab for ${address} in the space "${placed.space.name}", not in "${this.space.name}". ` +
          "Brigade moved nothing. Close that tab and try again.",
      );
    if (first && placed.index !== 1) await this.do("tab.move", { id: tab, index: "1" });
    // Only now: a space whose last tab closes is removed.
    if (shellTab) await this.do("tab.close", { id: shellTab, confirmed: "true" });
  }

  private isBrigade(space: LsSpace): boolean {
    return space.name === this.space.name && space.folder === this.space.folder;
  }

  private async showFound(place: Place, first: boolean): Promise<void> {
    if (first && place.index !== 1 && this.isBrigade(place.space))
      await this.do("tab.move", { id: place.tab.id, index: "1" });
    await this.do("space.select", { id: place.space.id });
    await this.do("tab.select", { id: place.tab.id });
  }

  /** Shows the Brigade space, or makes it. space.new gives it a shell tab, to close once brigade's tab is there. */
  private async enterSpace(layout: readonly LsSpace[]): Promise<{ spaceId: string; shellTab: string | null }> {
    const existing = layout.find((s) => this.isBrigade(s));
    if (existing) {
      await this.do("space.select", { id: existing.id });
      return { spaceId: existing.id, shellTab: null };
    }
    const made = parseObject(await this.do("space.new", { ...this.space }), "space.new");
    if (!text(made.space)) throw new Error("herdr-app space.new returned no space");
    return { spaceId: text(made.space), shellTab: text(made.tab) || null };
  }

  private async keep(address: string): Promise<string> {
    const out = await untilSeen(this.c, ["do", "terminal.keep", "--terminal", address, "--place", "tab"]);
    const tab = text(parseObject(out, "terminal.keep").tab);
    if (!tab) throw new Error(`herdr-app terminal.keep returned no tab for ${address}`);
    return tab;
  }

  /** terminal.keep answers before ls lists the new tab. */
  private async waitForTab(tab: string): Promise<Place> {
    const until = this.c.now() + FOCUS_WAIT_MS;
    for (;;) {
      const place = findPlace(await this.layout(), (t) => t.id === tab);
      if (place) return place;
      if (this.c.now() >= until) throw new Error(`herdr-app does not list the new tab ${tab}`);
      await this.c.sleep(FOCUS_RETRY_MS);
    }
  }

  private async layout(): Promise<LsSpace[]> {
    return parseLayout(await this.c.run(["ls"]));
  }

  private do(command: string, args: Readonly<Record<string, string>>): Promise<string> {
    return this.c.run(["do", command, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, v])]);
  }
}

/** Copies the mod into herdr-app's mods folder and writes its config (where to read, and how to start). Returns the folder. */
export async function installMod(
  source: string,
  herdrAppHome: string,
  where: { stateDir: string; configFile: string; start: readonly string[] },
): Promise<string> {
  const target = path.join(herdrAppHome, "mods", MOD_NAME);
  await mkdir(target, { recursive: true });
  for (const file of MOD_FILES) await copyFile(path.join(source, file), path.join(target, file));
  const config = [
    `// Written by "brigade mod install"; run it again to change.`,
    `export const STATE_DIR = ${JSON.stringify(where.stateDir)};`,
    `export const CONFIG_FILE = ${JSON.stringify(where.configFile)};`,
    "// The panel's Start button runs this: `brigade start` for this same config and state.",
    `export const START = ${JSON.stringify(where.start)};`,
    "",
  ].join("\n");
  await writeFile(path.join(target, "config.js"), config);
  return target;
}
