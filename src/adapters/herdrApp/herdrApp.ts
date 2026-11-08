// herdr-app, the Herdr window: focus an agent, open the Brigade panel, install and check the mod.
import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Runs herdr-app with these arguments and returns what it printed. */
export type HerdrAppRunner = (args: readonly string[]) => Promise<string>;

const CALL_TIMEOUT_MS = 15_000;
const MOD_NAME = "brigade";
/** herdr-app learns of a new hc terminal a moment after it starts; until then it says this. */
const NOT_SEEN_YET = "no running terminal";
const FOCUS_WAIT_MS = 10_000;
const FOCUS_RETRY_MS = 500;
/** The mod's files, copied as they are. config.js is written by the install. */
const MOD_FILES = ["main.js", "model.js", "mod.json", "brigade.svg"];

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

export class HerdrApp {
  private readonly run: HerdrAppRunner;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(run: HerdrAppRunner, options: HerdrAppOptions = {}) {
    this.run = run;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  /** Shows the agent's terminal in the window, so the owner can type to it. Waits while herdr-app catches up. */
  async focus(address: string): Promise<void> {
    const until = this.now() + FOCUS_WAIT_MS;
    for (;;) {
      try {
        await this.run(["do", "agent.focus", "--terminal", address]);
        return;
      } catch (err) {
        const notSeenYet = err instanceof Error && err.message.includes(NOT_SEEN_YET);
        if (!notSeenYet || this.now() >= until) throw err;
        await this.sleep(FOCUS_RETRY_MS);
      }
    }
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

/** Copies the mod into herdr-app's mods folder and writes its config. Returns the folder. */
export async function installMod(source: string, herdrAppHome: string, stateDir: string): Promise<string> {
  const target = path.join(herdrAppHome, "mods", MOD_NAME);
  await mkdir(target, { recursive: true });
  for (const file of MOD_FILES) await copyFile(path.join(source, file), path.join(target, file));
  const config = `// Written by "brigade mod install"; run it again to change.\nexport const STATE_DIR = ${JSON.stringify(stateDir)};\n`;
  await writeFile(path.join(target, "config.js"), config);
  return target;
}
