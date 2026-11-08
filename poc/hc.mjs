// Thin wrapper over the hc CLI (herdr-core). Every call has a timeout (guide C12).
import { execFileSync } from "node:child_process";

const HC = process.env.BRIGADE_HC || "hc";
const CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TRUST_WAIT_MS = 20_000;
const TRUST_POLL_MS = 500;
const TRUST_TEXT = "trust this folder";
// Claude Code's input footer: once it shows, there is no trust prompt to answer.
const READY_TEXT = /for shortcuts|accept edits on|bypass permissions on/;

export function hc(args) {
  return execFileSync(HC, args, { encoding: "utf8", timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
}

/** `--json` goes right after the subcommand: anything after `--` belongs to the program hc starts. */
export function hcJson([command, ...rest]) {
  return JSON.parse(hc([command, "--json", ...rest]));
}

/** Starts an agent in a new background terminal and returns its address (e.g. "t7"). */
export function launch({ name, cwd, labels, parent, notify, argv }) {
  const args = ["run", "--bg", "--name", name, "--cwd", cwd];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  if (parent) args.push("--parent", parent);
  if (!notify) args.push("--no-notify");
  const started = hcJson([...args, "--", ...argv]);
  return started.address;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Claude Code asks whether to trust a new folder, and its default answer is "No, exit".
 * Brigade made the folder, so it picks "Yes" (Down, Enter). Returns whether the prompt was seen.
 */
export function answerTrustPrompt(address) {
  const until = Date.now() + TRUST_WAIT_MS;
  while (Date.now() < until) {
    const screen = hc(["read", address, "--lines", "0"]);
    if (screen.includes(TRUST_TEXT)) {
      hc(["keys", address, "down", "enter"]);
      return true;
    }
    if (READY_TEXT.test(screen)) return false;
    sleep(TRUST_POLL_MS);
  }
  return false;
}
