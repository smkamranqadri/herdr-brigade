import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { FoundRepo, RepoFacts, Repos, RepoStatus } from "../../application/ports.ts";
import { git } from "./git.ts";
import { readRepoStatus } from "./repoStatus.ts";

/** find() stops at whichever limit comes first. */
export interface RepoSearchLimits {
  readonly maxDepth: number;
  readonly maxFolders: number;
  readonly maxResults: number;
  readonly maxMs: number;
}

const LIMITS: RepoSearchLimits = { maxDepth: 3, maxFolders: 2_000, maxResults: 20, maxMs: 10_000 };
const SKIPPED = new Set(["node_modules", "dist", "build", "target", "vendor"]);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The folders worth searching inside `dir`: no hidden folders, no dependency or build output. */
function subfolders(entries: readonly Dirent[], dir: string, depth: number): { dir: string; depth: number }[] {
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIPPED.has(e.name))
    .map((e) => ({ dir: path.join(dir, e.name), depth }));
}

/** The owner's local git repos, read-only. */
export class GitRepos implements Repos {
  private readonly limits: RepoSearchLimits;
  private readonly now: () => number;

  constructor(limits: Partial<RepoSearchLimits> = {}, now: () => number = Date.now) {
    this.limits = { ...LIMITS, ...limits };
    this.now = now;
  }

  /** Breadth first from each root; a git repo is a match or a dead end (its insides are not searched). */
  async find(roots: readonly string[], name: string): Promise<FoundRepo[]> {
    const want = squash(name);
    const found: FoundRepo[] = [];
    const queue = roots.map((dir) => ({ dir, depth: 0 }));
    const until = this.now() + this.limits.maxMs;
    let visited = 0;
    const withinLimits = () =>
      visited < this.limits.maxFolders && found.length < this.limits.maxResults && this.now() < until;
    for (let next = queue.shift(); next && withinLimits(); next = queue.shift()) {
      visited++;
      const entries = await readdir(next.dir, { withFileTypes: true }).catch(() => []);
      if (!entries.some((e) => e.name === ".git")) {
        if (next.depth < this.limits.maxDepth) queue.push(...subfolders(entries, next.dir, next.depth + 1));
      } else if (want && squash(path.basename(next.dir)).includes(want)) {
        found.push({ name: path.basename(next.dir), path: next.dir });
      }
    }
    return found;
  }

  async inspect(folder: string): Promise<RepoFacts | null> {
    let top: string;
    try {
      top = await git(["-C", folder, "rev-parse", "--show-toplevel"], "rev-parse");
    } catch {
      return null;
    }
    const isRoot = (await realpath(top)) === (await realpath(folder));
    const currentBranch = (await git(["-C", folder, "branch", "--show-current"], "branch")) || null;
    const origin = await git(["-C", folder, "remote", "get-url", "origin"], "remote get-url").catch(() => null);
    const head = await git(
      ["-C", folder, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      "symbolic-ref",
    )
      .then((ref) => ref.replace(/^origin\//, "") || null)
      .catch(() => null);
    return { isRoot, currentBranch, origin, originHead: head };
  }

  async hasBranch(folder: string, branch: string): Promise<boolean> {
    return git(["-C", folder, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], "rev-parse").then(
      () => true,
      () => false,
    );
  }

  status(folder: string): Promise<RepoStatus> {
    return readRepoStatus(folder);
  }
}
