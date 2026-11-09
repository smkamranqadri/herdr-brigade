// A repo's state for a status report, read only: --no-optional-locks keeps `git status` from refreshing the index,
// so it never takes a lock that another agent working in the repo needs.
import type { RepoStatus } from "../../application/ports.ts";
import { git } from "./git.ts";

const SHOWN_FILES = 8;
const SHOWN_COMMITS = 5;
const SHOWN_BRANCHES = 10;
const SEP = "\x1f";

const read = (folder: string, args: readonly string[], what: string, keepLeading = false) =>
  git(["--no-optional-locks", "-C", folder, ...args], what, keepLeading);

async function upstreamOf(folder: string): Promise<RepoStatus["upstream"]> {
  const name = await read(folder, ["rev-parse", "--abbrev-ref", "@{upstream}"], "rev-parse").catch(() => null);
  if (!name) return null;
  const counts = await read(folder, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], "rev-list");
  const [behind = 0, ahead = 0] = counts.split(/\s+/).map(Number);
  return { name, ahead, behind };
}

/** Counts from `git status --porcelain`: X is the staged side, Y the worktree side, "??" untracked. */
export function changesOf(porcelain: string): RepoStatus["changes"] {
  const lines = porcelain.split("\n").filter((l) => l.length > 3);
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const tracked = lines.filter((l) => !l.startsWith("??"));
  return {
    staged: tracked.filter((l) => l[0] !== " ").length,
    unstaged: tracked.filter((l) => l[1] !== " ").length,
    untracked,
    files: lines.slice(0, SHOWN_FILES).map((l) => l.slice(3)),
  };
}

/** Worktrees from `git worktree list --porcelain`: blocks of "worktree <path>" and "branch refs/heads/<name>". */
export function worktreesOf(porcelain: string): RepoStatus["worktrees"] {
  return porcelain
    .split("\n\n")
    .map((block) => block.split("\n"))
    .flatMap((lines) => {
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length) ?? null;
      return path ? [{ path, branch }] : [];
    });
}

const fields = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(SEP));

export async function readRepoStatus(folder: string): Promise<RepoStatus> {
  const [branch, upstream, porcelain, log, refs, worktrees] = await Promise.all([
    read(folder, ["branch", "--show-current"], "branch"),
    upstreamOf(folder),
    read(folder, ["status", "--porcelain=v1", "--untracked-files=normal"], "status", true),
    read(folder, ["log", `-${SHOWN_COMMITS}`, `--format=%h${SEP}%s${SEP}%cs`], "log").catch(() => ""),
    read(
      folder,
      [
        "for-each-ref",
        "--sort=-committerdate",
        `--count=${SHOWN_BRANCHES}`,
        `--format=%(refname:short)${SEP}%(committerdate:short)`,
        "refs/heads",
      ],
      "for-each-ref",
    ),
    read(folder, ["worktree", "list", "--porcelain"], "worktree list"),
  ]);
  return {
    branch: branch || null,
    upstream,
    changes: changesOf(porcelain),
    commits: fields(log).map(([sha = "", subject = "", date = ""]) => ({ sha, subject, date })),
    branches: fields(refs).map(([name = "", date = ""]) => ({ name, date })),
    worktrees: worktreesOf(worktrees),
  };
}
