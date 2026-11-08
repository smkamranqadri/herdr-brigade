// Adapter tests that touch the real file system and git, in temp folders.
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlEventLog } from "./eventlog/jsonlEventLog.ts";
import { GitWorktrees } from "./git/gitWorktrees.ts";
import { FilePrompts } from "./prompts/filePrompts.ts";
import { randomIds } from "./system/system.ts";

const temp = (name: string) => mkdtemp(path.join(tmpdir(), `brigade-${name}-`));

describe("JsonlEventLog", () => {
  it("reads back what it appended, and an empty log when the file is missing", async () => {
    const log = new JsonlEventLog(path.join(await temp("log"), "state", "events.jsonl"));
    expect(await log.read()).toEqual([]);
    const event = { at: "t", kind: "task_finished", task: "task-1", summary: "ok" } as const;
    await log.append(event);
    await log.append({ ...event, summary: "again" });
    expect(await log.read()).toEqual([event, { ...event, summary: "again" }]);
  });

  it("skips a last line that is still being written", async () => {
    const file = path.join(await temp("log"), "events.jsonl");
    const log = new JsonlEventLog(file);
    await log.append({ at: "t", kind: "task_asked", task: "task-1", question: "q" });
    await appendFile(file, '{"at":"t","kind":"task_fin');
    expect(await log.read()).toEqual([{ at: "t", kind: "task_asked", task: "task-1", question: "q" }]);
  });
});

describe("JsonlEventLog after a crash", () => {
  it("starts a new line after a fragment, so later events stay readable, and reports the damaged line", async () => {
    const file = path.join(await temp("log"), "events.jsonl");
    const bad: number[] = [];
    const log = new JsonlEventLog(file, (n) => bad.push(n));
    const asked = { at: "t", kind: "task_asked", task: "task-1", question: "q" } as const;
    await log.append(asked);
    await appendFile(file, '{"at":"t","kind":"task_fin');
    const finished = { at: "u", kind: "task_finished", task: "task-1", summary: "ok" } as const;
    await log.append(finished);
    expect(await log.read()).toEqual([asked, finished]);
    expect(bad).toEqual([2]);
  });
});

describe("GitWorktrees", () => {
  it("adds a worktree on a new branch from the base branch", async () => {
    const repo = path.join(await temp("repo"), "shop");
    await mkdir(repo);
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    await writeFile(path.join(repo, "README.md"), "# shop\n");
    git("add", "README.md");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "init");
    const root = await temp("worktrees");
    const folder = await new GitWorktrees(root).create(repo, "main", "brigade/login-1");
    expect(folder).toBe(path.join(root, "shop", "brigade/login-1"));
    expect(execFileSync("git", ["-C", folder, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe(
      "brigade/login-1",
    );
  });

  it("commits every change in a worktree, and returns null when there is nothing to commit", async () => {
    const repo = path.join(await temp("repo"), "shop");
    await mkdir(repo);
    const git = (dir: string, ...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.invalid");
    await writeFile(path.join(repo, "README.md"), "# shop\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-q", "-m", "init");
    const worktrees = new GitWorktrees(await temp("worktrees"));
    const folder = await worktrees.create(repo, "main", "brigade/login-1");
    await writeFile(path.join(folder, "login.txt"), "hello\n");
    await writeFile(path.join(folder, "README.md"), "# shop, changed\n");
    const commit = await worktrees.commit(folder, "Add login");
    expect(commit?.files).toBe(2);
    expect(commit?.sha).toBe(git(folder, "rev-parse", "--short=12", "HEAD"));
    expect(git(folder, "log", "-1", "--format=%s")).toBe("Add login");
    expect(git(folder, "status", "--short")).toBe("");
    expect(await worktrees.commit(folder, "Again")).toBeNull();
    expect(git(repo, "log", "-1", "--format=%s", "main")).toBe("init");
  });

  it("fails with git's own message when the base branch is missing", async () => {
    const repo = await temp("empty");
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await expect(new GitWorktrees(await temp("wt")).create(repo, "nope", "b")).rejects.toThrow(
      "git worktree add failed:",
    );
  });
});

describe("FilePrompts", () => {
  it("fills placeholders and refuses one with no value", async () => {
    const dir = await temp("prompts");
    await writeFile(path.join(dir, "worker.md"), "Task {{TASK}} for {{OWNER}}.");
    const prompts = new FilePrompts(dir);
    expect(await prompts.render("worker", { TASK: "task-1", OWNER: "Sam" })).toBe("Task task-1 for Sam.");
    await expect(prompts.render("worker", { TASK: "task-1" })).rejects.toThrow(
      "prompts/worker.md uses {{OWNER}}, which has no value",
    );
  });
});

describe("randomIds", () => {
  it("makes task ids of six hex characters", () => {
    expect(randomIds.taskId()).toMatch(/^task-[0-9a-f]{6}$/);
  });
});
