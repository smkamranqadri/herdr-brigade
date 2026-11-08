// GitHub through the gh CLI, with the owner's existing login. Brigade never reads, prints or passes a token.
import { execFile } from "node:child_process";
import type { GitHub, PullRequest } from "../../application/ports.ts";
import type { PrState } from "../../domain/events.ts";

/** Runs gh with these arguments and returns what it printed. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

const CALL_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const FIELDS = "number,url,state,headRefName,baseRefName,headRefOid,mergedAt";
const LIST_LIMIT = "20";
const STATES: Readonly<Partial<Record<string, PrState>>> = { OPEN: "open", CLOSED: "closed", MERGED: "merged" };

export function ghRunner(bin = "gh"): GhRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const env = { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };
      const options = { timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" as const, env };
      execFile(bin, [...args], options, (err, stdout, stderr) => {
        if (err) reject(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || err.message}`));
        else resolve(stdout.trim());
      });
    });
}

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** One PR from gh's JSON, checked field by field (guide C7). */
function toPullRequest(raw: unknown): PullRequest {
  const f = new Map<string, unknown>(Object.entries(typeof raw === "object" && raw !== null ? raw : {}));
  const number = f.get("number");
  const state = STATES[text(f.get("state")) ?? ""];
  const [url, head, base] = [text(f.get("url")), text(f.get("headRefName")), text(f.get("baseRefName"))];
  if (typeof number !== "number" || !state || !url || !head || !base) {
    throw new Error(`gh returned a pull request brigade can't read: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return { number, url, state, head, base, headSha: text(f.get("headRefOid")), mergedAt: text(f.get("mergedAt")) };
}

export class GhCli implements GitHub {
  private readonly run: GhRunner;

  constructor(run: GhRunner) {
    this.run = run;
  }

  async pullRequestsFor(repo: string, head: string): Promise<PullRequest[]> {
    const out = await this.run([
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      head,
      "--state",
      "all",
      "--limit",
      LIST_LIMIT,
      "--json",
      FIELDS,
    ]);
    const list: unknown = JSON.parse(out);
    if (!Array.isArray(list)) throw new Error("gh pr list didn't return a list");
    return list.map(toPullRequest);
  }

  async create(repo: string, pr: { head: string; base: string; title: string; body: string }): Promise<PullRequest> {
    const out = await this.run([
      "pr",
      "create",
      "--repo",
      repo,
      "--head",
      pr.head,
      "--base",
      pr.base,
      "--title",
      pr.title,
      "--body",
      pr.body,
    ]);
    const num = /\/pull\/(\d+)\s*$/.exec(out)?.[1];
    if (!num) throw new Error(`gh pr create didn't print the new pull request's URL: ${out.slice(0, 200)}`);
    return this.view(repo, Number(num));
  }

  async edit(repo: string, num: number, pr: { title: string; body: string }): Promise<void> {
    await this.run(["pr", "edit", String(num), "--repo", repo, "--title", pr.title, "--body", pr.body]);
  }

  async view(repo: string, num: number): Promise<PullRequest> {
    return toPullRequest(JSON.parse(await this.run(["pr", "view", String(num), "--repo", repo, "--json", FIELDS])));
  }
}
