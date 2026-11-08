import { describe, expect, it } from "vitest";
import type { BrigadeEvent } from "./events.ts";
import { derivePrs, prLine, prStale } from "./pullRequests.ts";

const opened = (number: number, at: string): BrigadeEvent => ({
  at,
  kind: "pr_opened",
  task: "task-1",
  repo: "acme/shop",
  number,
  url: `https://github.com/acme/shop/pull/${number}`,
  head: "brigade/login-1",
  base: "main",
});
const state = (number: number, s: "open" | "closed" | "merged", at: string): BrigadeEvent => ({
  at,
  kind: "pr_state",
  task: "task-1",
  number,
  state: s,
  headSha: "abc",
  mergedAt: s === "merged" ? at : null,
});

describe("derivePrs", () => {
  it("follows a task's PR through its states, ignoring states for another number", () => {
    const pr = derivePrs([
      opened(7, "2026-11-09T10:00:00.000Z"),
      state(7, "merged", "2026-11-09T11:00:00.000Z"),
      state(8, "closed", "2026-11-09T12:00:00.000Z"),
    ]).get("task-1");
    expect(pr).toEqual({
      repo: "acme/shop",
      number: 7,
      url: "https://github.com/acme/shop/pull/7",
      head: "brigade/login-1",
      base: "main",
      state: "merged",
      headSha: "abc",
      checkedAt: "2026-11-09T11:00:00.000Z",
    });
  });

  it("keeps the known state when the same PR is opened again (an update), and starts over for a new number", () => {
    const events = [opened(7, "1"), state(7, "open", "2"), opened(7, "3")];
    expect(derivePrs(events).get("task-1")?.checkedAt).toBe("2");
    expect(derivePrs([...events, opened(9, "4")]).get("task-1")).toMatchObject({
      number: 9,
      state: "open",
      checkedAt: "4",
    });
  });
});

describe("prStale and prLine", () => {
  const now = new Date("2026-11-09T10:10:00.000Z");
  const pr = derivePrs([opened(7, "2026-11-09T10:00:00.000Z")]).get("task-1");

  it("reads a PR again after 30 seconds, and never after a merge", () => {
    if (!pr) throw new Error("no pr");
    expect(prStale(pr, now, 30_000)).toBe(true);
    expect(prStale({ ...pr, checkedAt: "2026-11-09T10:09:50.000Z" }, now, 30_000)).toBe(false);
    expect(prStale({ ...pr, state: "merged" }, now, 30_000)).toBe(false);
  });

  it("says the state and how old it is", () => {
    if (!pr) throw new Error("no pr");
    expect(prLine(pr, now)).toBe("PR #7 open, checked 10 min ago (https://github.com/acme/shop/pull/7)");
    expect(prLine({ ...pr, checkedAt: "2026-11-09T10:09:50.000Z" }, now)).toBe(
      "PR #7 open, checked just now (https://github.com/acme/shop/pull/7)",
    );
  });
});
