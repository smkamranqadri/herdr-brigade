import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { changesOf, readRepoStatus, worktreesOf } from "./repoStatus.ts";

const run = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.invalid", ...args], {
    encoding: "utf8",
  }).trim();

describe("readRepoStatus", () => {
  // The owner's own git config must not change what these tests see.
  beforeAll(async () => {
    const empty = path.join(await mkdtemp(path.join(tmpdir(), "brigade-gitconfig-")), "config");
    await writeFile(empty, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", empty);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  });
  afterAll(() => vi.unstubAllEnvs());

  async function busyRepo() {
    const base = await mkdtemp(path.join(tmpdir(), "brigade-status-"));
    const origin = path.join(base, "origin.git");
    const repo = path.join(base, "shop");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    execFileSync("git", ["clone", "-q", origin, repo]);
    for (const n of ["a", "b", "c"]) {
      await writeFile(path.join(repo, `${n}.txt`), `${n}\n`);
      run(repo, "add", `${n}.txt`);
      run(repo, "commit", "-q", "-m", `Add ${n}`);
    }
    run(repo, "push", "-q", "-u", "origin", "main");
    await writeFile(path.join(repo, "d.txt"), "d\n");
    run(repo, "add", "d.txt");
    run(repo, "commit", "-q", "-m", "Add d");
    run(repo, "branch", "feature/x");
    run(repo, "worktree", "add", "-q", path.join(base, "wt"), "feature/x");
    await writeFile(path.join(repo, "a.txt"), "a, changed\n");
    await writeFile(path.join(repo, "b.txt"), "b, staged\n");
    run(repo, "add", "b.txt");
    await writeFile(path.join(repo, "new.txt"), "new\n");
    return { base, repo };
  }

  it("reads branch, upstream, changes, commits, branches and worktrees", async () => {
    const { base, repo } = await busyRepo();
    const s = await readRepoStatus(repo);
    expect(s.branch).toBe("main");
    expect(s.upstream).toEqual({ name: "origin/main", ahead: 1, behind: 0 });
    expect(s.changes).toEqual({ staged: 1, unstaged: 1, untracked: 1, files: ["a.txt", "b.txt", "new.txt"] });
    expect(s.commits.map((c) => c.subject)).toEqual(["Add d", "Add c", "Add b", "Add a"]);
    expect(s.commits[0]?.sha).toBe(run(repo, "rev-parse", "--short", "HEAD"));
    expect(s.branches.map((b) => b.name).sort()).toEqual(["feature/x", "main"]);
    expect(s.worktrees).toEqual([
      { path: repo, branch: "main" },
      { path: path.join(base, "wt"), branch: "feature/x" },
    ]);
  });

  it("never rewrites the index, so it can't take a lock another agent needs", async () => {
    const { repo } = await busyRepo();
    run(repo, "status", "--short"); // a plain status refreshes the index first
    const index = path.join(repo, ".git", "index");
    const before = await readFile(index);
    // A changed file time makes a plain `git status` refresh and rewrite the index.
    await utimes(path.join(repo, "c.txt"), new Date(), new Date(Date.now() + 60_000));
    await readRepoStatus(repo);
    expect((await readFile(index)).equals(before)).toBe(true);
  });
});

describe("changesOf and worktreesOf", () => {
  it("count both sides of a file changed in the index and the worktree", () => {
    expect(changesOf("MM both.txt\n?? new.txt\n D gone.txt\n")).toEqual({
      staged: 1,
      unstaged: 2,
      untracked: 1,
      files: ["both.txt", "new.txt", "gone.txt"],
    });
    expect(worktreesOf("worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /w\nHEAD def\ndetached\n")).toEqual([
      { path: "/r", branch: "main" },
      { path: "/w", branch: null },
    ]);
  });
});
