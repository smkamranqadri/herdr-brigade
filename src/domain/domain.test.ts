import { describe, expect, it } from "vitest";
import { parseConfig, serializeConfig, withBaseBranch, withProject, type BrigadeConfig } from "./config.ts";
import { githubRepoOf } from "./github.ts";
import { errorCode } from "./errors.ts";
import { branchFor, deriveTasks } from "./tasks.ts";

const roles = {
  coordinator: { harness: "claude", model: "claude-opus-5-5", effort: "medium" },
  captain: { harness: "codex", model: "gpt-6.1-terra", effort: "low" },
  worker: { harness: "pi", model: "openai/gpt-6.1-sol", effort: "low" },
};

describe("parseConfig", () => {
  it("accepts a valid config, with workers on auto and the rest on ask unless it says otherwise", () => {
    const projects = [{ name: "shop", repo: "/repos/shop", baseBranch: "main", github: null }];
    expect(
      parseConfig({ owner: "Sam", roles, projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main" }] }),
    ).toEqual({
      ok: true,
      value: {
        owner: "Sam",
        repoRoots: null,
        roles: {
          coordinator: { ...roles.coordinator, permissions: "ask" },
          captain: { ...roles.captain, permissions: "ask" },
          worker: { ...roles.worker, permissions: "auto" },
        },
        projects,
      },
    });
    const bypass = { ...roles, captain: { ...roles.captain, permissions: "bypass" } };
    const parsed = parseConfig({ owner: "Sam", roles: bypass, projects });
    expect(parsed.ok && parsed.value.roles.captain.permissions).toBe("bypass");
  });

  it("rejects an unknown permission level", () => {
    const raw = { owner: "Sam", roles: { ...roles, worker: { ...roles.worker, permissions: "yolo" } }, projects: [] };
    expect(parseConfig(raw)).toEqual({ ok: false, errors: ["roles.worker.permissions must be ask, auto or bypass"] });
  });

  it("lists every problem at once", () => {
    const raw = {
      owner: "",
      roles: { ...roles, worker: { harness: "cursor", model: "", effort: "huge" } },
      projects: [{ name: "Shop!", repo: "repos/shop", baseBranch: "main" }],
    };
    expect(parseConfig(raw)).toEqual({
      ok: false,
      errors: [
        "owner must be your name",
        "roles.worker.harness must be claude, codex or pi",
        "roles.worker.model must be a model name",
        "roles.worker.effort must be low, medium, high, xhigh or max",
        "projects[0].name must be 1-24 of a-z, 0-9 and -",
        "projects[0].repo must be an absolute path",
      ],
    });
  });

  it("keeps a valid project when another part of the config is wrong", () => {
    const raw = { owner: "", roles, projects: [{ name: "shop", repo: "/r", baseBranch: "main" }] };
    expect(parseConfig(raw)).toEqual({ ok: false, errors: ["owner must be your name"] });
  });

  it("rejects duplicate project names and a missing roles block", () => {
    const p = { name: "shop", repo: "/r", baseBranch: "main" };
    expect(parseConfig({ owner: "Sam", projects: [p, p] })).toEqual({
      ok: false,
      errors: ["roles must have coordinator, captain and worker", "project names must be unique: shop"],
    });
    expect(parseConfig([])).toEqual({ ok: false, errors: ["the config must be a JSON object"] });
  });
});

describe("branchFor", () => {
  it("joins a slug of the title and the task id", () => {
    expect(branchFor("task-a1b2c3", "Fix the Login bug!")).toBe("brigade/fix-the-login-bug-a1b2c3");
  });

  it("cuts a long title at 32 characters without a trailing dash", () => {
    expect(branchFor("task-1", "Ijlas invitation poster for social media and WhatsApp")).toBe(
      "brigade/ijlas-invitation-poster-for-soci-1",
    );
  });

  it("works for a title with no letters", () => {
    expect(branchFor("task-1", "!!!")).toBe("brigade/1");
  });
});

describe("deriveTasks", () => {
  const spec = { harness: "claude", model: "m", effort: "low", permissions: "auto" } as const;
  const created = {
    kind: "task_created",
    project: "shop",
    task: "task-1",
    title: "T",
    branch: "b",
    worktree: "w",
    terminal: "t5",
    spec,
  } as const;

  it("follows a task from created to asking to finished", () => {
    const tasks = deriveTasks([
      { ...created, at: "1" },
      { kind: "task_asked", task: "task-1", question: "Which?", at: "2" },
      { kind: "task_finished", task: "task-1", summary: "Done", at: "3" },
    ]);
    expect(tasks).toEqual([
      {
        id: "task-1",
        project: "shop",
        title: "T",
        branch: "b",
        worktree: "w",
        terminal: "t5",
        spec,
        repo: null,
        baseBranch: null,
        state: "finished",
        note: "Done",
        updatedAt: "3",
      },
    ]);
  });

  it("puts a task back to working when its worker gets a follow-up, but not for a report upward", () => {
    const followUp = (to: "worker" | "coordinator", at: string) =>
      ({
        kind: "message_sent",
        from: "captain",
        to,
        project: "shop",
        task: to === "worker" ? "task-1" : null,
        text: "x",
        at,
      }) as const;
    const asked = { kind: "task_asked", task: "task-1", question: "Which?", at: "2" } as const;
    expect(deriveTasks([{ ...created, at: "1" }, asked, followUp("worker", "3")])[0]).toMatchObject({
      state: "working",
      updatedAt: "3",
    });
    const finished = { kind: "task_finished", task: "task-1", summary: "Done", at: "2" } as const;
    expect(deriveTasks([{ ...created, at: "1" }, finished, followUp("coordinator", "3")])[0]).toMatchObject({
      state: "finished",
      updatedAt: "2",
    });
  });

  it("takes a resumed worker's new terminal and keeps the task's state", () => {
    const resumed = { kind: "worker_resumed", project: "shop", task: "task-1", terminal: "t9", at: "2" } as const;
    expect(deriveTasks([{ ...created, at: "1" }, resumed])[0]).toMatchObject({
      terminal: "t9",
      state: "working",
      updatedAt: "2",
    });
  });

  it("ignores events for unknown tasks and unrelated events", () => {
    expect(
      deriveTasks([
        { kind: "task_finished", task: "task-9", summary: "x", at: "1" },
        { kind: "agent_started", role: "coordinator", project: null, terminal: "t1", spec, at: "2" },
      ]),
    ).toEqual([]);
  });
});

describe("errorCode", () => {
  it("reads a string code and ignores everything else", () => {
    expect(errorCode(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(errorCode({ code: 2 })).toBeUndefined();
    expect(errorCode(new Error("x"))).toBeUndefined();
    expect(errorCode("ENOENT")).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});

describe("githubRepoOf", () => {
  it.each([
    ["https://github.com/acme/shop.git", "acme/shop"],
    ["https://github.com/acme/shop", "acme/shop"],
    ["git@github.com:acme/shop.git", "acme/shop"],
    ["ssh://git@github.com/acme/shop.git", "acme/shop"],
    ["https://gitlab.com/acme/shop.git", null],
    ["https://github.com.evil.io/acme/shop.git", null],
    ["https://github.com/acme/shop/extra", null],
    ["/srv/git/shop.git", null],
  ])("reads %s as %s", (url, repo) => {
    expect(githubRepoOf(url)).toBe(repo);
  });
});

describe("project config", () => {
  const config: BrigadeConfig = {
    owner: "Sam",
    roles: {
      coordinator: { harness: "claude", model: "m", effort: "low", permissions: "ask" },
      captain: { harness: "claude", model: "m", effort: "low", permissions: "ask" },
      worker: { harness: "claude", model: "m", effort: "low", permissions: "auto" },
    },
    repoRoots: null,
    projects: [{ name: "shop", repo: "/repos/shop", baseBranch: "main", github: "acme/shop" }],
  };
  const blog = { name: "blog", repo: "/repos/blog", baseBranch: "main", github: null };

  it("adds a project with a valid, unused name and an unused repo", () => {
    expect(withProject(config, blog).projects.map((p) => p.name)).toEqual(["shop", "blog"]);
    expect(() => withProject(config, { ...blog, name: "Blog!" })).toThrow('"Blog!" is not a valid project name');
    expect(() => withProject(config, { ...blog, name: "shop" })).toThrow('A project named "shop" already exists.');
    expect(() => withProject(config, { ...blog, repo: "/repos/shop" })).toThrow("/repos/shop is already a project.");
  });

  it("changes only the base branch of the named project", () => {
    expect(withBaseBranch(config, "shop", "release").projects).toEqual([
      { ...config.projects[0], baseBranch: "release" },
    ]);
    expect(() => withBaseBranch(config, "blog", "x")).toThrow('No project "blog".');
  });

  it("writes the config back out and reads it again unchanged, leaving null settings out", () => {
    const json = serializeConfig(withProject(config, blog));
    expect(json.projects).toEqual([
      { name: "shop", repo: "/repos/shop", baseBranch: "main", github: "acme/shop" },
      { name: "blog", repo: "/repos/blog", baseBranch: "main" },
    ]);
    expect("repoRoots" in json).toBe(false);
    expect(parseConfig(json)).toEqual({ ok: true, value: withProject(config, blog) });
  });

  it("rejects a malformed github repo or repoRoots", () => {
    const raw = serializeConfig(config);
    expect(parseConfig({ ...raw, repoRoots: ["relative/path"] })).toEqual({
      ok: false,
      errors: ["repoRoots must be a list of absolute paths"],
    });
    const bad = { ...raw, projects: [{ name: "shop", repo: "/r", baseBranch: "main", github: "not a repo" }] };
    expect(parseConfig(bad)).toEqual({ ok: false, errors: ["projects[0].github must be owner/name on GitHub"] });
  });
});
