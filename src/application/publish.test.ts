import { describe, expect, it } from "vitest";
import { createTask } from "./captain.ts";
import { listTasks } from "./coordinator.ts";
import { ctx, fakeDeps } from "./fakes.ts";
import { createPullRequest, refreshPrs } from "./publish.ts";

const captain = ctx({ role: "captain", terminal: "t3", project: "shop" });
const pr = { title: "Fix login", body: "Fixes it. Tested." };

async function withTask() {
  const f = fakeDeps();
  await createTask(f.deps, captain, { title: "Login", prompt: "Fix it." });
  const worker = ctx({
    role: "worker",
    terminal: "t1",
    project: "shop",
    task: "task-000001",
    title: "Login",
    parent: "t3",
  });
  return { f, worker, branch: "brigade/login-000001" };
}

describe("createPullRequest", () => {
  it("asks GitHub first, pushes the task branch to the pinned repo, opens the PR and records it", async () => {
    const { f, worker, branch } = await withTask();
    expect(await createPullRequest(f.deps, worker, pr)).toBe("Opened PR #42: https://github.com/acme/shop/pull/42");
    expect(f.github.calls).toEqual([`list acme/shop ${branch}`, `create acme/shop ${branch}->main "Fix login"`]);
    expect(f.worktrees.pushes).toEqual([
      { target: { worktree: `/worktrees/${branch}`, repo: "/repos/shop", branch }, github: "acme/shop" },
    ]);
    expect(f.events.events.filter((e) => e.kind === "pr_opened" || e.kind === "pr_state").map((e) => e.kind)).toEqual([
      "pr_opened",
      "pr_state",
    ]);
  });

  it("updates the open PR on a second call instead of opening another", async () => {
    const { f, worker } = await withTask();
    await createPullRequest(f.deps, worker, pr);
    expect(await createPullRequest(f.deps, worker, { ...pr, title: "Fix login, take 2" })).toBe(
      "Updated PR #42: https://github.com/acme/shop/pull/42",
    );
    expect(f.github.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
    expect(f.github.calls).toContain('edit acme/shop #42 "Fix login, take 2"');
  });

  it("after a crash before the PR was recorded, finds the PR on GitHub instead of opening a second", async () => {
    const { f, worker, branch } = await withTask();
    f.github.prs.push({
      repo: "acme/shop",
      number: 7,
      url: "https://github.com/acme/shop/pull/7",
      state: "open",
      head: branch,
      base: "main",
      headSha: "x",
      mergedAt: null,
    });
    expect(await createPullRequest(f.deps, worker, pr)).toBe("Updated PR #7: https://github.com/acme/shop/pull/7");
    expect(f.github.calls.filter((c) => c.startsWith("create"))).toEqual([]);
  });

  it("two calls at once open one PR", async () => {
    const { f, worker } = await withTask();
    const both = await Promise.all([createPullRequest(f.deps, worker, pr), createPullRequest(f.deps, worker, pr)]);
    expect(both).toEqual([
      "Opened PR #42: https://github.com/acme/shop/pull/42",
      "Updated PR #42: https://github.com/acme/shop/pull/42",
    ]);
  });

  it.each(["merged", "closed"] as const)("never pushes to the branch of a %s PR", async (state) => {
    const { f, worker, branch } = await withTask();
    f.github.prs.push({
      repo: "acme/shop",
      number: 7,
      url: "u",
      state,
      head: branch,
      base: "main",
      headSha: "x",
      mergedAt: null,
    });
    await expect(createPullRequest(f.deps, worker, pr)).rejects.toThrow(
      `PR #7 for ${branch} is ${state}. Its branch is finished: the work needs a new task.`,
    );
    expect(f.worktrees.pushes).toEqual([]);
  });

  it("refuses a project with no GitHub repo, and anyone but the task's worker, before touching GitHub", async () => {
    const f = fakeDeps({
      config: {
        ...fakeDeps().deps.config,
        projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main", github: null }],
      },
    });
    await createTask(f.deps, captain, { title: "Login", prompt: "p" });
    const worker = ctx({ role: "worker", project: "shop", task: "task-000001", title: "Login", parent: "t3" });
    await expect(createPullRequest(f.deps, worker, pr)).rejects.toThrow(
      "Project shop has no GitHub repo, so it can't publish.",
    );
    await expect(createPullRequest(f.deps, captain, pr)).rejects.toThrow(
      "Only a worker opens its task's pull request.",
    );
    const stranger = ctx({ role: "worker", project: "shop", task: "task-999", title: "x", parent: "t3" });
    await expect(createPullRequest(f.deps, stranger, pr)).rejects.toThrow("Brigade has no record of task-999 in shop.");
    expect(f.github.calls).toEqual([]);
    expect(f.worktrees.pushes).toEqual([]);
  });

  it("targets the base branch the task started from, even after the project's base changed", async () => {
    const { f, worker, branch } = await withTask();
    const moved = {
      ...f.deps.config,
      projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "release", github: "acme/shop" }],
    };
    await createPullRequest({ ...f.deps, config: moved }, worker, pr);
    expect(f.github.calls).toContain(`create acme/shop ${branch}->main "Fix login"`);
  });
});

describe("live PR state", () => {
  it("list_tasks shows each task's PR, reading a stale state from GitHub", async () => {
    const { f, worker } = await withTask();
    await createPullRequest(f.deps, worker, pr);
    const pushed = f.github.prs[0];
    if (!pushed) throw new Error("no pr");
    f.github.prs[0] = { ...pushed, state: "merged" };
    const later = { ...f.deps, clock: { ...f.deps.clock, now: () => new Date("2026-11-08T10:05:00.000Z") } };
    expect(await listTasks(later, "shop")).toBe(
      'task-000001 [shop] "Login" working (terminal t1, working, codex) PR #42 merged, checked just now (https://github.com/acme/shop/pull/42)',
    );
  });

  it("keeps the last known state, with its age, when GitHub doesn't answer", async () => {
    const { f, worker } = await withTask();
    await createPullRequest(f.deps, worker, pr);
    f.github.failViews = true;
    const later = { ...f.deps, clock: { ...f.deps.clock, now: () => new Date("2026-11-08T10:05:00.000Z") } };
    const prs = await refreshPrs(later, ["task-000001"]);
    expect(prs.get("task-000001")).toMatchObject({ state: "open", checkedAt: "2026-11-08T10:00:00.000Z" });
  });

  const fiveMinutesLater = (
    f: ReturnType<typeof fakeDeps>,
    wait: (ms: number) => Promise<void> = (ms) => f.deps.clock.wait(ms),
  ) => ({
    ...f.deps,
    clock: { now: () => new Date("2026-11-08T10:05:00.000Z"), wait },
  });
  async function openPrs(count: number) {
    const f = fakeDeps();
    const tasks = Array.from({ length: count }, (_, i) => `task-${i + 1}`);
    for (const [i, task] of tasks.entries()) {
      const url = `https://github.com/acme/shop/pull/${i + 1}`;
      const head = `brigade/${task}`;
      await f.deps.events.append({
        at: "2026-11-08T10:00:00.000Z",
        kind: "pr_opened",
        task,
        repo: "acme/shop",
        number: i + 1,
        url,
        head,
        base: "main",
      });
    }
    return { f, tasks };
  }
  const views = (f: ReturnType<typeof fakeDeps>) => f.github.calls.filter((c) => c.startsWith("view"));

  it("stops waiting for GitHub after 15 seconds, starts no new check, and reports the last known states", async () => {
    const { f, tasks } = await openPrs(8);
    let answer = (): void => undefined;
    f.github.viewsWaitFor = new Promise<void>((resolve) => (answer = resolve));
    const waits: number[] = [];
    const prs = await refreshPrs(
      fiveMinutesLater(f, (ms) => (waits.push(ms), Promise.resolve())),
      tasks,
    );
    expect(waits).toEqual([15_000]);
    expect(prs.get("task-1")).toMatchObject({ state: "open", checkedAt: "2026-11-08T10:00:00.000Z" });
    answer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(views(f)).toEqual(["view acme/shop #1", "view acme/shop #2", "view acme/shop #3", "view acme/shop #4"]);
  });

  it("asks about the PRs it asked about least recently first, so failing ones don't crowd out the rest", async () => {
    const { f, tasks } = await openPrs(9);
    f.github.failViews = true;
    await refreshPrs(fiveMinutesLater(f), tasks);
    await refreshPrs(fiveMinutesLater(f), tasks);
    expect(views(f).slice(8)).toEqual([
      "view acme/shop #9",
      "view acme/shop #1",
      "view acme/shop #2",
      "view acme/shop #3",
      "view acme/shop #4",
      "view acme/shop #5",
      "view acme/shop #6",
      "view acme/shop #7",
    ]);
  });

  it("doesn't ask GitHub again within 30 seconds", async () => {
    const { f, worker } = await withTask();
    await createPullRequest(f.deps, worker, pr);
    const views = f.github.calls.length;
    await refreshPrs(f.deps, ["task-000001"]);
    expect(f.github.calls.length).toBe(views);
  });
});
