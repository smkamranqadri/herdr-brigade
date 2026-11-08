import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Commit, CommitTarget, Worktrees } from "../../application/ports.ts";
import { BrigadeError } from "../../domain/errors.ts";

const GIT_TIMEOUT_MS = 60_000;

/** Runs git; `what` names the step in an error, such as "worktree add". */
function git(args: readonly string[], what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { timeout: GIT_TIMEOUT_MS, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${what} failed: ${stderr.trim() || err.message}`));
      else resolve(stdout.trim());
    });
  });
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
    const pinned = ["--git-dir", gitDir, "--work-tree", target.worktree];
    await git([...pinned, "add", "-A"], "add");
    const staged = (await git([...pinned, "diff", "--cached", "--name-only"], "diff")).split("\n").filter(Boolean);
    if (staged.length === 0) return null;
    await git([...pinned, "commit", "-q", "-m", message], "commit");
    const sha = await git([...pinned, "rev-parse", "--short=12", "HEAD"], "rev-parse");
    return { sha, files: staged.length };
  }
}

/** The worktree's own git folder, once its top folder, repo and branch all match the task's record. */
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
