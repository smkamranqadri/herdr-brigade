import { execFile } from "node:child_process";
import type {
  HerdrTerminal,
  TerminalInfo,
  TerminalLaunch,
  Terminals,
  TrustOutcome,
  TrustPrompt,
} from "../../application/ports.ts";

/** Runs hc with these arguments and returns what it printed. */
export type HcRunner = (args: readonly string[]) => Promise<string>;

const CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TRUST_WAIT_MS = 30_000;
const TRUST_POLL_MS = 500;
/** After a key press, time for the program to redraw before the screen is read again. */
const TRUST_KEY_SETTLE_MS = 1_000;
/** Codex draws its ready footer for about a second before its trust prompt, so ready must hold this long. */
const READY_STABLE_MS = 3_000;
const SEND_WAIT_MS = 30_000;
const SEND_RETRY_MS = 1_000;
/** hc's refusal while a just-started program's output settles: "nothing was typed", so a retry is safe. */
const STILL_STARTING = '"kind":"unavailable"';
/** After sending to an idle agent, how long to wait for its turn to start before checking for a lost Enter. */
const TURN_START_WAIT_MS = 20_000;
const TURN_POLL_MS = 1_000;
/** A line drawn across the screen: pi and Claude Code draw one above and one below their input box. */
const RULE = /^─{20,}$/;
/** The prompt mark at the start of an input box (Claude Code's ❯), which is not part of the text. */
const PROMPT_MARK = /^[❯›>]/;

export function hcRunner(hcPath: string): HcRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        hcPath,
        [...args],
        { timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`hc ${args[0] ?? ""} failed: ${stderr.trim() || err.message}`));
          else resolve(stdout);
        },
      );
    });
}

interface HcTerminalJson {
  address: string;
  name?: string;
  status?: string | { state?: string } | null;
  agent?: string | null;
  where?: string | null;
  cwd?: string | null;
  state?: string;
}

function statusWord(status: unknown): string | null {
  if (typeof status === "string") return status;
  const state = typeof status === "object" && status !== null && "state" in status ? status.state : null;
  return typeof state === "string" ? state : null;
}

/** The next key for a trust prompt on this screen: Enter on the "yes" choice, Down anywhere else. */
export function trustKey(screen: string, trust: TrustPrompt): "enter" | "down" {
  const selected = screen.split("\n").find((line) => line.trimStart().startsWith(trust.cursor));
  return selected?.includes(trust.yes) ? "enter" : "down";
}

/** What a starting agent's screen shows: no session to resume, the trust prompt, the ready text, or none yet. */
function startScreen(screen: string, trust: TrustPrompt): "no_session" | "prompt" | "ready" | "starting" {
  if (trust.noSession !== undefined && screen.includes(trust.noSession)) return "no_session";
  if (screen.includes(trust.text)) return "prompt";
  return trust.ready.some((r) => screen.includes(r)) ? "ready" : "starting";
}

/**
 * Whether the input box holds exactly this text and nothing else. The box is what lies between the screen's last two
 * rules. Spaces and line breaks are ignored, since the box wraps. With no box found, or any other text in it (such
 * as the owner's own edit), the answer is no.
 */
export function stillInInput(screen: string, text: string): boolean {
  const lines = screen.split("\n");
  const rules = lines.flatMap((line, i) => (RULE.test(line.trim()) ? [i] : []));
  const [top, bottom] = rules.slice(-2);
  if (top === undefined || bottom === undefined) return false;
  const squeeze = (s: string) => s.replace(/\s+/g, "");
  const box = squeeze(lines.slice(top + 1, bottom).join("")).replace(PROMPT_MARK, "");
  return box.length > 0 && box === squeeze(text);
}

export interface HcTerminalsOptions {
  readonly run: HcRunner;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** The Terminals port over the hc CLI. */
export class HcTerminals implements Terminals {
  private readonly run: HcRunner;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: HcTerminalsOptions) {
    this.run = options.run;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  async launch(req: TerminalLaunch): Promise<string> {
    // --json goes right after the subcommand: everything after "--" belongs to the program.
    const args = ["run", "--json", "--bg", ...(req.outliveParent ? ["--outlive-parent"] : []), "--name", req.name];
    args.push("--cwd", req.cwd);
    for (const [k, v] of Object.entries(req.labels)) args.push("--label", `${k}=${v}`);
    if (req.parent) args.push("--parent", req.parent);
    else args.push("--no-parent", "--no-notify");
    const out = JSON.parse(await this.run([...args, "--", ...req.argv])) as { address?: unknown };
    if (typeof out.address !== "string") throw new Error(`hc run returned no address for ${req.name}`);
    return out.address;
  }

  /**
   * Answers a trust prompt one checked key at a time: Enter when the cursor is on "yes", else Down. A press the
   * program drops (it can draw the prompt before it reads keys) is simply repeated. Answered means the prompt is
   * gone and the ready text shows; ready means the ready text held for READY_STABLE_MS with no prompt; no_session
   * means the program printed that it found no session to resume. Claude Code asks about trust before it looks for
   * a session, so a gone prompt alone is not enough: it may still end with no session.
   */
  async answerTrust(address: string, trust: TrustPrompt): Promise<TrustOutcome> {
    const until = this.now() + TRUST_WAIT_MS;
    let pressed = false;
    let readySince: number | null = null;
    while (this.now() < until) {
      const screen = await this.run(["read", address, "--lines", "0"]);
      const seen = startScreen(screen, trust);
      if (seen === "no_session") return "no_session";
      if (seen === "prompt") {
        await this.run(["keys", address, trustKey(screen, trust)]);
        [pressed, readySince] = [true, null];
        await this.sleep(TRUST_KEY_SETTLE_MS);
        continue;
      }
      if (pressed && seen === "ready") return "answered";
      // Once pressed, a ready screen has already returned above.
      readySince = seen === "ready" ? (readySince ?? this.now()) : null;
      if (readySince !== null && this.now() - readySince >= READY_STABLE_MS) return "ready";
      await this.sleep(TRUST_POLL_MS);
    }
    return "timeout";
  }

  /** hc kill answers for a terminal that already ended too; hc rm then frees its name. */
  async keepOff(address: string): Promise<void> {
    await this.run(["keep", address, "--off"]);
    const got: unknown = JSON.parse(await this.run(["get", address, "--json"]));
    const on = typeof got === "object" && got !== null && "keep" in got ? got.keep : undefined;
    if (on !== false)
      throw new Error(`Core keep is still on for ${address}. Turn it off with: hc keep ${address} --off`);
  }

  async remove(address: string): Promise<void> {
    await this.run(["kill", address]);
    await this.run(["rm", address]);
  }

  /**
   * Types the text and presses Enter. A just-started agent's refusal ("still starting") is retried. An agent that was
   * idle can take the text but drop the Enter (seen with pi), so its turn is watched, and Enter is pressed once more
   * if the text is still in its input box. An agent already working gets no check: its message waits in its queue.
   */
  async send(address: string, text: string): Promise<void> {
    const before = await this.info(address);
    await this.typeAndSend(address, text);
    if (before.working) return;
    const until = this.now() + TURN_START_WAIT_MS;
    while (this.now() < until) {
      const now = await this.info(address);
      if (now.working || now.turn > before.turn) return;
      await this.sleep(TURN_POLL_MS);
    }
    const screen = await this.run(["read", address, "--lines", "0"]);
    if (stillInInput(screen, text)) await this.run(["keys", address, "enter"]);
  }

  private async typeAndSend(address: string, text: string): Promise<void> {
    const until = this.now() + SEND_WAIT_MS;
    for (;;) {
      try {
        await this.run(["send", address, text]);
        return;
      } catch (err) {
        const starting = err instanceof Error && err.message.includes(STILL_STARTING);
        if (!starting || this.now() >= until) throw err;
        await this.sleep(SEND_RETRY_MS);
      }
    }
  }

  /** The agent's turn number and whether it is working right now. */
  private async info(address: string): Promise<{ turn: number; working: boolean }> {
    const got: unknown = JSON.parse(await this.run(["get", address, "--json"]));
    if (typeof got !== "object" || got === null) return { turn: 0, working: false };
    const turn = "turn" in got && typeof got.turn === "number" ? got.turn : 0;
    return { turn, working: "status" in got && statusWord(got.status) === "working" };
  }

  // `hc ls --json` leaves labels out of its output, so hc does the matching.
  async find(labels: Readonly<Record<string, string>>): Promise<TerminalInfo[]> {
    const all = await this.ls(Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]));
    return all.map((t) => ({ address: t.address, name: t.name ?? "", status: statusWord(t.status) }));
  }

  async all(): Promise<HerdrTerminal[]> {
    return (await this.ls([]))
      .filter((t) => t.state === undefined || t.state === "live")
      .map((t) => ({
        address: t.address,
        program: t.agent ?? null,
        status: statusWord(t.status),
        where: t.where ?? null,
        cwd: t.cwd ?? null,
      }));
  }

  private async ls(filters: readonly string[]): Promise<HcTerminalJson[]> {
    const parsed = JSON.parse(await this.run(["ls", "--json", ...filters])) as
      { terminals?: HcTerminalJson[] } | HcTerminalJson[];
    return Array.isArray(parsed) ? parsed : (parsed.terminals ?? []);
  }
}
