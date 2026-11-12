import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Commit, CommitTarget, Worktrees } from "../../application/ports.ts";
import { BrigadeError } from "../../domain/errors.ts";
import { githubRepoOf } from "../../domain/github.ts";
import { git } from "./git.ts";

/**
 * brigade's git calls run outside the agent's sandbox. For a sandboxed agent they run no hooks: a hook (or a hook
 * manager such as lefthook) can run commands the agent wrote into its worktree.
 */
const hooks = (runHooks: boolean) => (runHooks ? [] : ["-c", "core.hooksPath=/dev/null"]);

/** The arguments of the task branch's push: that one branch, no tags, no submodules, no force. */
export function pushArgs(gitDir: string, target: CommitTarget, url: string): string[] {
  const ref = `refs/heads/${target.branch}`;
  const pinned = [...hooks(target.runHooks), "--git-dir", gitDir, "--work-tree", target.worktree];
  return [...pinned, "push", "--no-follow-tags", "--recurse-submodules=no", url, `${ref}:${ref}`];
}

/** One worktree per task, under `<root>/<repo folder name>/<branch>`: the place the herdr-app worktree mod uses. */
export class GitWorktrees implements Worktrees {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async create(repo: string, baseBranch: string, branch: string): Promise<string> {
    const folder = path.join(this.root, path.basename(repo), branch);
    await git(["-C", repo, "worktree", "add", "-b", branch, folder, baseBranch], "worktree add");
    return folder;
  }

  /**
   * Runs outside any agent's sandbox, so a sandboxed agent can still commit. That makes it a privileged step, so it
   * first checks the worktree is still the task's own: its top folder, the repo it belongs to, and its branch. An
   * agent could edit the worktree's .git file or switch branch; then brigade refuses instead of committing elsewhere.
   */
  async commit(target: CommitTarget, message: string): Promise<Commit | null> {
    const gitDir = await verifiedGitDir(target);
    const pinned = [...hooks(target.runHooks), "--git-dir", gitDir, "--work-tree", target.worktree];
    await git([...pinned, "add", "-A"], "add");
    const staged = (await git([...pinned, "diff", "--cached", "--name-only"], "diff")).split("\n").filter(Boolean);
    if (staged.length === 0) return null;
    await git([...pinned, "commit", "-q", "-m", message], "commit");
    const sha = await git([...pinned, "rev-parse", "--short=12", "HEAD"], "rev-parse");
    return { sha, files: staged.length };
  }

  async verify(target: CommitTarget): Promise<void> {
    await verifiedGitDir(target);
  }

  /**
   * Pushes only the task's branch, to the checked URL itself (not to the name "origin", which an agent could repoint
   * between the check and the push). No force: git refuses anything but a fast-forward.
   */
  async push(target: CommitTarget, github: string): Promise<void> {
    const gitDir = await verifiedGitDir(target);
    const url = await checkedPushUrl(gitDir, github);
    await git(pushArgs(gitDir, target, url), "push");
  }
}

/** A URL without any user name or password in it, safe to show in a message. */
export function withoutCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/** The prefixes that git's url.<base>.insteadOf and pushInsteadOf rules rewrite, from every config scope. */
async function rewrittenPrefixes(gitDir: string): Promise<string[]> {
  const entries = (await git(["--git-dir", gitDir, "config", "--list", "-z"], "config")).split("\0");
  return entries.flatMap((entry) => {
    const [key = "", value = ""] = entry.split("\n");
    return /^url\..+\.(insteadof|pushinsteadof)$/.test(key) ? [value] : [];
  });
}

/**
 * The URL brigade will push to: origin's push URL, only if it is `github` on github.com. git rewrites a URL once
 * more when it pushes to it, so a url.*.insteadOf rule that matches this URL is refused too: it would send the push
 * somewhere else.
 */
async function checkedPushUrl(gitDir: string, github: string): Promise<string> {
  const url = await git(["--git-dir", gitDir, "remote", "get-url", "--push", "origin"], "remote get-url");
  if (githubRepoOf(url) !== github) {
    throw new BrigadeError(
      `Brigade won't push: origin is ${withoutCredentials(url)}, not github.com/${github}, the project's pinned repo.`,
    );
  }
  const rule = (await rewrittenPrefixes(gitDir)).find((prefix) => url.startsWith(prefix));
  if (rule !== undefined) {
    throw new BrigadeError(
      `Brigade won't push: a git url rewrite rule for "${withoutCredentials(rule)}" would send ${url} somewhere else.`,
    );
  }
  return url;
}

/**
 * The worktree's own git folder, once its top folder, repo, git folder and branch all match the task's record. Each
 * check stops a case the others miss: a subfolder, a forged git folder planted in .git/worktrees, the repo's own git
 * folder, and a switched branch (one test each in adapters.test.ts).
 */
async function verifiedGitDir({ worktree, repo, branch }: CommitTarget): Promise<string> {
  const at = ["-C", worktree];
  const [top, common, gitDir, current] = await Promise.all([
    git([...at, "rev-parse", "--show-toplevel"], "rev-parse"),
    git([...at, "rev-parse", "--path-format=absolute", "--git-common-dir"], "rev-parse"),
    git([...at, "rev-parse", "--absolute-git-dir"], "rev-parse"),
    git([...at, "branch", "--show-current"], "branch"),
  ]);
  const repoGit = await realpath(path.join(repo, ".git"));
  const problems = [
    (await realpath(top)) !== (await realpath(worktree)) && `its top folder is ${top}`,
    (await realpath(common)) !== repoGit && `it belongs to ${common}, not ${repoGit}`,
    !(await realpath(gitDir)).startsWith(path.join(repoGit, "worktrees") + path.sep) && `its git folder is ${gitDir}`,
    current !== branch && `it is on ${current || "a detached HEAD"}, not ${branch}`,
  ].filter((p): p is string => typeof p === "string");
  if (problems.length)
    throw new BrigadeError(`Brigade won't commit: this is no longer the task's worktree (${problems.join("; ")}).`);
  return gitDir;
}
