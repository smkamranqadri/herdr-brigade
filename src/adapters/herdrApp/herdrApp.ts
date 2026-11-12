// herdr-app, the Herdr window: brigade's spaces and tabs, the Brigade panel, and installing and checking the mod.
import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenOptions, SpacePlace, Workspace } from "../../application/ports.ts";
import { BrigadeError } from "../../domain/errors.ts";

/** Runs herdr-app with these arguments and returns what it printed. */
export type HerdrAppRunner = (args: readonly string[]) => Promise<string>;

const CALL_TIMEOUT_MS = 15_000;
const MOD_NAME = "brigade";
/** herdr-app learns of a new hc terminal a moment after it starts; until then it says this. */
const NOT_SEEN_YET = "no running terminal";
const FOCUS_WAIT_MS = 10_000;
const FOCUS_RETRY_MS = 500;
/**
 * The mod's files, copied as they are, in this order. herdr-app reloads the mod when main.js is
 * saved, so main.js goes last, after config.js and the files it imports.
 */
const MOD_FILES = ["model.js", "mod.json", "brigade.svg", "panel.svg", "main.js"];

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
  private readonly run: HerdrAppRunner;

  constructor(run: HerdrAppRunner) {
    this.run = run;
  }

  /** Opens (or closes) the Brigade panel as a window. */
  async openPanel(): Promise<void> {
    await this.run(["do", "mod.open", "--name", MOD_NAME]);
  }

  /** Loads the mod once and renders it; fails with herdr-app's exact error. */
  async check(modDir: string): Promise<string> {
    return (await this.run(["check", modDir])).trim();
  }
}

interface LsTab {
  readonly id: string;
  readonly active: boolean;
  readonly terminals: readonly string[];
}

interface LsSpace {
  readonly id: string;
  readonly name: string;
  readonly folder: string | null;
  readonly active: boolean;
  readonly tabs: readonly LsTab[];
}

/** A tab, its space, and its position there (1 = first). */
interface Place {
  readonly space: LsSpace;
  readonly tab: LsTab;
  readonly index: number;
}

/** What the owner sees: the shown space and its shown tab, when it has one. */
interface View {
  readonly space: string;
  readonly tab: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function parseObject(out: string, what: string): Record<string, unknown> {
  const got: unknown = JSON.parse(out);
  if (!isObject(got)) throw new Error(`herdr-app ${what} returned no object`);
  return got;
}

/** `herdr-app ls`: spaces, their tabs, the terminals in each tab, and which space and tabs are shown. */
function parseLayout(out: string): LsSpace[] {
  const got = parseObject(out, "ls");
  if (!Array.isArray(got.spaces)) throw new Error("herdr-app ls returned no spaces");
  return objects(got.spaces).map((s) => ({
    id: text(s.id),
    name: text(s.name),
    folder: typeof s.folder === "string" ? s.folder : null,
    active: s.active === true,
    tabs: objects(s.tabs).map((t) => ({
      id: text(t.id),
      active: t.active === true,
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

function shownView(spaces: readonly LsSpace[]): View | null {
  const space = spaces.find((s) => s.active);
  if (!space) return null;
  return { space: space.id, tab: space.tabs.find((t) => t.active)?.id ?? null };
}

/** herdr-app's answer when an id is gone: the owner closed that tab or space meanwhile. */
const GONE = /no such (tab|space)/;

/**
 * herdr-app as brigade's Workspace. A tab comes from terminal.keep, which needs a running terminal and puts the tab in
 * the shown space. `tab.select` also shows the tab's space. Probed on 2026-11-11 and 2026-11-12 (docs/herdr-app.md).
 */
export class HerdrAppWorkspace implements Workspace {
  private readonly c: Clocked;

  constructor(run: HerdrAppRunner, options: HerdrAppOptions = {}) {
    this.c = clocked(run, options);
  }

  async check(): Promise<void> {
    try {
      await this.c.run(["status"]);
    } catch (err) {
      throw new BrigadeError(`herdr-app is not running. Open it, then try again. (${messageOf(err)})`);
    }
  }

  async open(address: string, options: OpenOptions): Promise<void> {
    const layout = await this.layout();
    const view = options.returnToView ? shownView(layout) : null;
    let failure: Error | null = null;
    try {
      await this.show(layout, address, options);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    }
    const restoreError = view ? await this.restore(view) : null;
    if (failure !== null && restoreError === null) throw failure;
    if (failure !== null || restoreError !== null)
      throw new BrigadeError(
        [failure, restoreError]
          .filter((e) => e !== null)
          .map(messageOf)
          .join("\n"),
      );
  }

  private async show(layout: readonly LsSpace[], address: string, { place, first }: OpenOptions): Promise<void> {
    const found = findPlace(layout, (t) => t.terminals.includes(address));
    if (found) return this.showFound(found, place, first);
    const { spaceId, shellTab } = await this.enterSpace(layout, place);
    const tab = await this.keep(address);
    const placed = await this.waitForTab(tab);
    if (placed.space.id !== spaceId)
      throw new BrigadeError(
        `herdr-app put the tab for ${address} in the space "${placed.space.name}", not in "${place.name}". ` +
          "Brigade moved nothing. Close that tab and try again.",
      );
    if (first && placed.index !== 1) await this.do("tab.move", { id: tab, index: "1" });
    // Only now: a space whose last tab closes is removed.
    if (shellTab) await this.do("tab.close", { id: shellTab, confirmed: "true" });
  }

  private async showFound(found: Place, place: SpacePlace, first: boolean): Promise<void> {
    if (first && found.index !== 1 && found.space.folder === place.folder)
      await this.do("tab.move", { id: found.tab.id, index: "1" });
    await this.do("space.select", { id: found.space.id });
    await this.do("tab.select", { id: found.tab.id });
  }

  /** Shows the place's space, or makes it. space.new gives it a shell tab, to close once brigade's tab is there. */
  private async enterSpace(
    layout: readonly LsSpace[],
    place: SpacePlace,
  ): Promise<{ spaceId: string; shellTab: string | null }> {
    const existing = layout.find((s) => s.folder === place.folder);
    if (existing) {
      await this.do("space.select", { id: existing.id });
      return { spaceId: existing.id, shellTab: null };
    }
    const made = parseObject(await this.do("space.new", { name: place.name, folder: place.folder }), "space.new");
    if (!text(made.space)) throw new Error("herdr-app space.new returned no space");
    return { spaceId: text(made.space), shellTab: text(made.tab) || null };
  }

  /** Shows the earlier tab, or its space when the tab has gone. Returns an error to report, or null. */
  private async restore(view: View): Promise<string | null> {
    try {
      if (view.tab) {
        const shown = await this.selectUnlessGone("tab.select", view.tab);
        if (shown) return null;
      }
      await this.selectUnlessGone("space.select", view.space);
      return null;
    } catch (err) {
      return `Brigade could not show your earlier tab again: ${messageOf(err)}`;
    }
  }

  /** Runs a select; false when its id has gone. */
  private async selectUnlessGone(command: string, id: string): Promise<boolean> {
    try {
      await this.do(command, { id });
      return true;
    } catch (err) {
      if (GONE.test(messageOf(err))) return false;
      throw err;
    }
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
  where: { stateDir: string; configFile: string; start: readonly string[]; open: readonly string[] },
): Promise<string> {
  const target = path.join(herdrAppHome, "mods", MOD_NAME);
  await mkdir(target, { recursive: true });
  const config = [
    `// Written by "brigade mod install"; run it again to change.`,
    `export const STATE_DIR = ${JSON.stringify(where.stateDir)};`,
    `export const CONFIG_FILE = ${JSON.stringify(where.configFile)};`,
    "// The panel's Start button runs this: `brigade start` for this same config and state.",
    `export const START = ${JSON.stringify(where.start)};`,
    "// A click on the Coordinator or a Captain runs this with the terminal's address: `brigade open <address>`.",
    `export const OPEN = ${JSON.stringify(where.open)};`,
    "",
  ].join("\n");
  await writeFile(path.join(target, "config.js"), config);
  for (const file of MOD_FILES) await copyFile(path.join(source, file), path.join(target, file));
  return target;
}
