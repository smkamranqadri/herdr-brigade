import { describe, expect, it } from "vitest";
import { ctx, fakeDeps } from "./fakes.ts";
import type { RepoStatus } from "./ports.ts";
import { herdrAgents, repoStatus } from "./status.ts";

const coordinator = ctx({ role: "coordinator", terminal: "t1" });
const captain = ctx({ role: "captain", terminal: "t3", project: "shop" });

const busy: RepoStatus = {
  branch: "feature/login",
  upstream: { name: "origin/feature/login", ahead: 2, behind: 1 },
  changes: { staged: 1, unstaged: 2, untracked: 1, files: ["src/a.ts", "src/b.ts", "notes.md"] },
  commits: [
    { sha: "abc1234", subject: "Add login form", date: "2026-11-08" },
    { sha: "def5678", subject: "Start login", date: "2026-11-07" },
  ],
  branches: [
    { name: "feature/login", date: "2026-11-08" },
    { name: "main", date: "2026-11-01" },
  ],
  worktrees: [
    { path: "/repos/shop", branch: "feature/login" },
    { path: "/w/shop/fix", branch: null },
  ],
};
const quiet: RepoStatus = {
  ...busy,
  branch: null,
  upstream: null,
  changes: { staged: 0, unstaged: 0, untracked: 0, files: [] },
  commits: [],
  branches: [],
};

function withShop(status: RepoStatus = busy) {
  const f = fakeDeps();
  f.repos.statuses.set("/repos/shop", status);
  return f;
}

describe("repoStatus", () => {
  it("reports a project's branch, changes, commits, branches, worktrees and open PRs, read now", async () => {
    const f = withShop();
    f.github.prs.push({
      repo: "acme/shop",
      number: 12,
      url: "u",
      state: "open",
      head: "brigade/x-1",
      base: "main",
      headSha: null,
      mergedAt: null,
    });
    expect(await repoStatus(f.deps, coordinator, { project: "shop" })).toBe(
      [
        "shop (/repos/shop), checked 2026-11-08 10:00 UTC.",
        "Branch: feature/login, 2 ahead and 1 behind origin/feature/login.",
        "Uncommitted changes: 1 staged, 2 unstaged, 1 untracked (src/a.ts, src/b.ts, notes.md).",
        "Last commits: abc1234 2026-11-08 Add login form | def5678 2026-11-07 Start login.",
        "Branches: feature/login (2026-11-08), main (2026-11-01).",
        "Worktrees: /repos/shop (feature/login), /w/shop/fix (detached).",
        'Open pull requests on acme/shop: #12 "PR 12" (brigade/x-1).',
      ].join("\n"),
    );
  });

  it("says plainly when there is nothing, no upstream, or no GitHub repo", async () => {
    const f = withShop(quiet);
    const local = {
      ...f.deps.config,
      projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main", github: null }],
    };
    expect((await repoStatus({ ...f.deps, config: local }, captain, {})).split("\n").slice(1)).toEqual([
      "Branch: a detached HEAD, with no upstream.",
      "Uncommitted changes: none.",
      "Last commits: none.",
      "Branches: none.",
      "Worktrees: /repos/shop (feature/login), /w/shop/fix (detached).",
      "Open pull requests: none known; the project has no GitHub repo.",
    ]);
  });

  it("still reports the repo when GitHub doesn't answer", async () => {
    const f = withShop();
    f.github.failLists = true;
    expect((await repoStatus(f.deps, coordinator, { project: "shop" })).split("\n").at(-1)).toBe(
      "Open pull requests on acme/shop: couldn't read GitHub (gh pr list failed: network).",
    );
  });

  it("keeps a Captain to its own project, and needs a project from the Coordinator", async () => {
    const f = withShop();
    expect(await repoStatus(f.deps, captain, { project: "shop" })).toContain("shop (/repos/shop)");
    await expect(repoStatus(f.deps, captain, { project: "blog" })).rejects.toThrow(
      "Out of scope: blog is not your project.",
    );
    await expect(repoStatus(f.deps, coordinator, {})).rejects.toThrow("Name the project: repo_status(project).");
    await expect(repoStatus(f.deps, coordinator, { project: "nope" })).rejects.toThrow('No project "nope".');
    const worker = ctx({ role: "worker", project: "shop", task: "t-1", title: "x", parent: "t3" });
    await expect(repoStatus(f.deps, worker, { project: "shop" })).rejects.toThrow(
      "Only the Coordinator and Captains read repo status.",
    );
  });
});

describe("herdrAgents", () => {
  it("lists every live terminal, marks brigade's, and counts the agents", async () => {
    const f = fakeDeps();
    f.terminals.others.push(
      { address: "t3x", program: "claude-code", status: "idle", where: "shop / Claude Code", cwd: "/r/shop" },
      { address: "t2b", program: "bash", status: null, where: "blog / blog", cwd: "/r/blog" },
    );
    f.terminals.live.push({
      address: "t17x",
      name: "bg-coordinator",
      status: "idle",
      labels: { brigade: "main", harness: "claude" },
    });
    expect(await herdrAgents(f.deps, coordinator)).toBe(
      [
        "3 live terminals, 2 of them agents:",
        "t3x: claude-code · idle · shop / Claude Code · /r/shop",
        "t2b: bash · no status · blog / blog · /r/blog",
        "t17x: claude · idle · no pane · unknown folder (brigade)",
      ].join("\n"),
    );
  });

  it("is for the Coordinator only, and says when Herdr has nothing", async () => {
    const f = fakeDeps();
    expect(await herdrAgents(f.deps, coordinator)).toBe("No live terminals in Herdr.");
    await expect(herdrAgents(f.deps, captain)).rejects.toThrow("Only the Coordinator lists Herdr's agents.");
  });
});
