import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitRepos } from "./gitRepos.ts";

async function makeRepo(dir: string, origin?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  await writeFile(path.join(dir, "README.md"), "# r\n");
  git("add", "README.md");
  git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init");
  if (origin) git("remote", "add", "origin", origin);
}

describe("GitRepos.find", () => {
  it("finds repos by part of the folder name, at most 3 levels down, and not inside other repos", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brigade-repos-"));
    await makeRepo(path.join(root, "side projects", "harbor-books"));
    await makeRepo(path.join(root, "clients", "acme", "Harbor_App"));
    await makeRepo(path.join(root, "a", "b", "c", "harbor-too-deep"));
    await makeRepo(path.join(root, "harbor-host"));
    await makeRepo(path.join(root, "harbor-host", "inner-harbor"));
    await mkdir(path.join(root, "node_modules", "harbor"), { recursive: true });
    const found = await new GitRepos().find([root], "harbor");
    expect(found.map((r) => path.relative(root, r.path)).sort()).toEqual([
      "clients/acme/Harbor_App",
      "harbor-host",
      "side projects/harbor-books",
    ]);
  });

  it("stops at its folder limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brigade-repos-"));
    for (const n of ["a1", "a2", "a3"]) await makeRepo(path.join(root, n));
    expect(await new GitRepos({ maxFolders: 2 }).find([root], "a")).toHaveLength(1);
  });
});

describe("GitRepos.inspect and hasBranch", () => {
  it("reports the top folder, current branch and origin", async () => {
    const repo = path.join(await mkdtemp(path.join(tmpdir(), "brigade-repos-")), "shop");
    await makeRepo(repo, "git@github.com:acme/shop.git");
    await mkdir(path.join(repo, "src"));
    const repos = new GitRepos();
    expect(await repos.inspect(repo)).toEqual({
      isRoot: true,
      currentBranch: "main",
      origin: "git@github.com:acme/shop.git",
    });
    expect(await repos.inspect(path.join(repo, "src"))).toMatchObject({ isRoot: false });
    expect(await repos.inspect(tmpdir())).toBeNull();
    expect([await repos.hasBranch(repo, "main"), await repos.hasBranch(repo, "nope")]).toEqual([true, false]);
  });
});
