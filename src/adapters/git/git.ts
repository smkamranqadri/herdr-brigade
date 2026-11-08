import { execFile } from "node:child_process";

const GIT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Runs git with no prompts and returns its trimmed output; `what` names the step in an error, such as "worktree add". */
export function git(args: readonly string[], what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    execFile(
      "git",
      [...args],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", env },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${what} failed: ${stderr.trim() || err.message}`));
        else resolve(stdout.trim());
      },
    );
  });
}
