import type { BrigadeEvent, PrState } from "./events.ts";

/** A task's pull request as brigade last knew it. */
export interface TaskPr {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly head: string;
  readonly base: string;
  /** Null until brigade has read it from GitHub. */
  readonly state: PrState | null;
  readonly headSha: string | null;
  readonly checkedAt: string | null;
}

/** Each task's newest pull request and its last known state, from the event log. */
export function derivePrs(events: readonly BrigadeEvent[]): Map<string, TaskPr> {
  const prs = new Map<string, TaskPr>();
  for (const e of events) {
    if (e.kind === "pr_opened") {
      const known = prs.get(e.task);
      const same = known?.number === e.number && known.repo === e.repo;
      const { repo, number, url, head, base } = e;
      prs.set(e.task, {
        repo,
        number,
        url,
        head,
        base,
        ...(same ? pick(known) : { state: "open", headSha: null, checkedAt: e.at }),
      });
    }
    const pr = e.kind === "pr_state" ? prs.get(e.task) : undefined;
    if (e.kind === "pr_state" && pr?.number === e.number) {
      prs.set(e.task, { ...pr, state: e.state, headSha: e.headSha, checkedAt: e.at });
    }
  }
  return prs;
}

const pick = (pr: TaskPr) => ({ state: pr.state, headSha: pr.headSha, checkedAt: pr.checkedAt });

/** Whether a PR's state should be read again: never read, or read more than `maxAgeMs` ago. A merge is final. */
export function prStale(pr: TaskPr, now: Date, maxAgeMs: number): boolean {
  if (pr.state === "merged") return false;
  return pr.checkedAt === null || now.getTime() - Date.parse(pr.checkedAt) > maxAgeMs;
}

/** "#12 open, checked 3 min ago" for a report. */
export function prLine(pr: TaskPr, now: Date): string {
  const state = pr.state ?? "state unknown";
  if (pr.checkedAt === null) return `PR #${pr.number} ${state} (${pr.url})`;
  const minutes = Math.round((now.getTime() - Date.parse(pr.checkedAt)) / 60_000);
  const age = minutes < 1 ? "just now" : `${minutes} min ago`;
  return `PR #${pr.number} ${state}, checked ${age} (${pr.url})`;
}
