import { execFile } from "node:child_process";
import path from "node:path";
import type { Worktrees } from "../../application/ports.ts";

const GIT_TIMEOUT_MS = 60_000;

function git(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { timeout: GIT_TIMEOUT_MS, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.slice(2, 4).join(" ")} failed: ${stderr.trim() || err.message}`));
      else resolve(stdout);
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
    await git(["-C", repo, "worktree", "add", "-b", branch, folder, baseBranch]);
    return folder;
  }
}
