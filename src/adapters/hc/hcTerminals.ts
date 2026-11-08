import { execFile } from "node:child_process";
import type { TerminalInfo, TerminalLaunch, Terminals, TrustOutcome, TrustPrompt } from "../../application/ports.ts";

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
/** The input box is at the bottom of the screen, so the end of unsent text is in its last lines. */
const INPUT_LINES = 12;
const TEXT_PROBE_CHARS = 40;

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

/** Whether the end of the text is in the screen's last lines. Spaces and line breaks are ignored, since the box wraps. */
export function stillInInput(screen: string, text: string): boolean {
  const squeeze = (s: string) => s.replace(/\s+/g, "");
  const bottom = squeeze(screen.trimEnd().split("\n").slice(-INPUT_LINES).join(""));
  const end = squeeze(text).slice(-TEXT_PROBE_CHARS);
  return end.length > 0 && bottom.includes(end);
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
    const args = ["run", "--json", "--bg", "--outlive-parent", "--name", req.name, "--cwd", req.cwd];
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
   * gone; ready means the ready text held for READY_STABLE_MS with no prompt.
   */
  async answerTrust(address: string, trust: TrustPrompt): Promise<TrustOutcome> {
    const until = this.now() + TRUST_WAIT_MS;
    let pressed = false;
    let readySince: number | null = null;
    while (this.now() < until) {
      const screen = await this.run(["read", address, "--lines", "0"]);
      if (screen.includes(trust.text)) {
        await this.run(["keys", address, trustKey(screen, trust)]);
        [pressed, readySince] = [true, null];
        await this.sleep(TRUST_KEY_SETTLE_MS);
        continue;
      }
      if (pressed) return "answered";
      readySince = trust.ready.some((r) => screen.includes(r)) ? (readySince ?? this.now()) : null;
      if (readySince !== null && this.now() - readySince >= READY_STABLE_MS) return "ready";
      await this.sleep(TRUST_POLL_MS);
    }
    return "timeout";
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
    const args = ["ls", "--json", ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`])];
    const parsed = JSON.parse(await this.run(args)) as { terminals?: HcTerminalJson[] } | HcTerminalJson[];
    const all = Array.isArray(parsed) ? parsed : (parsed.terminals ?? []);
    return all.map((t) => ({ address: t.address, name: t.name ?? "", status: statusWord(t.status) }));
  }
}
