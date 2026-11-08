import { describe, expect, it } from "vitest";
import { ctx, fakeDeps } from "./fakes.ts";
import { addProject, findRepo, updateProject } from "./projects.ts";

const coordinator = ctx({ role: "coordinator", terminal: "t1" });

function withBlogRepo(origin: string | null = "git@github.com:acme/blog.git") {
  const f = fakeDeps();
  f.repos.folders.set("/repos/blog", { isRoot: true, currentBranch: "main", origin, branches: ["main", "release"] });
  return f;
}

describe("addProject", () => {
  it("adds the repo with its current branch, pins its GitHub repo, and records it", async () => {
    const f = withBlogRepo();
    expect(await addProject(f.deps, coordinator, { name: "blog", repo: "/repos/blog/" })).toBe(
      "Added project blog: /repos/blog, base branch main. It publishes pull requests to github.com/acme/blog.",
    );
    expect(f.configStore.config.projects.at(-1)).toEqual({
      name: "blog",
      repo: "/repos/blog",
      baseBranch: "main",
      github: "acme/blog",
    });
    expect(f.events.events).toEqual([
      {
        kind: "project_added",
        project: "blog",
        repo: "/repos/blog",
        baseBranch: "main",
        github: "acme/blog",
        at: "2026-11-08T10:00:00.000Z",
      },
    ]);
  });

  it("pins no GitHub repo for an origin elsewhere, and says it can't publish", async () => {
    const f = withBlogRepo("https://gitlab.com/acme/blog.git");
    expect(await addProject(f.deps, coordinator, { name: "blog", repo: "/repos/blog", baseBranch: "release" })).toBe(
      "Added project blog: /repos/blog, base branch release. It has no GitHub origin, so it can't publish.",
    );
    expect(f.configStore.config.projects.at(-1)?.github).toBeNull();
  });

  it.each([
    [{ name: "blog", repo: "blog" }, 'The repo must be an absolute path, not "blog".'],
    [{ name: "blog", repo: "/repos/none" }, "/repos/none is not a git repo."],
    [{ name: "blog", repo: "/repos/blog", baseBranch: "nope" }, '/repos/blog has no branch "nope".'],
    [{ name: "shop", repo: "/repos/blog" }, 'A project named "shop" already exists.'],
  ])("refuses %j", async (input, message) => {
    const f = withBlogRepo();
    await expect(addProject(f.deps, coordinator, input)).rejects.toThrow(message);
    expect(f.configStore.writes).toBe(0);
    expect(f.events.events).toEqual([]);
  });

  it("refuses a folder inside a repo, a detached repo with no base given, and any role but the Coordinator", async () => {
    const f = withBlogRepo();
    f.repos.folders.set("/repos/blog/src", { isRoot: false, currentBranch: "main", origin: null, branches: ["main"] });
    f.repos.folders.set("/repos/detached", { isRoot: true, currentBranch: null, origin: null, branches: ["main"] });
    await expect(addProject(f.deps, coordinator, { name: "src", repo: "/repos/blog/src" })).rejects.toThrow(
      "is inside a git repo",
    );
    await expect(addProject(f.deps, coordinator, { name: "det", repo: "/repos/detached" })).rejects.toThrow(
      "is not on a branch; give the base branch.",
    );
    await expect(
      addProject(f.deps, ctx({ role: "captain", project: "shop" }), { name: "blog", repo: "/repos/blog" }),
    ).rejects.toThrow("Only the Coordinator manages projects.");
    expect(f.configStore.writes).toBe(0);
  });
});

describe("updateProject", () => {
  it("changes the base branch when the branch exists, and records it", async () => {
    const f = fakeDeps();
    f.repos.folders.set("/repos/shop", {
      isRoot: true,
      currentBranch: "main",
      origin: null,
      branches: ["main", "release"],
    });
    expect(await updateProject(f.deps, coordinator, { name: "shop", baseBranch: "release" })).toBe(
      "Project shop now starts new tasks from release. Running tasks keep their base branch.",
    );
    expect(f.configStore.config.projects[0]).toEqual({
      name: "shop",
      repo: "/repos/shop",
      baseBranch: "release",
      github: "acme/shop",
    });
    expect(f.events.events[0]).toMatchObject({ kind: "project_changed", project: "shop", baseBranch: "release" });
    await expect(updateProject(f.deps, coordinator, { name: "shop", baseBranch: "nope" })).rejects.toThrow(
      'has no branch "nope"',
    );
    await expect(updateProject(f.deps, coordinator, { name: "blog", baseBranch: "main" })).rejects.toThrow(
      'No project "blog".',
    );
  });
});

describe("findRepo", () => {
  it("searches the default roots when the config names none, and lists what it found", async () => {
    const f = fakeDeps();
    f.repos.found.push({ name: "harbor-books", path: "/home/sam/Repositories/side/harbor-books" });
    expect(await findRepo(f.deps, coordinator, { name: "harbor" })).toBe(
      "harbor-books: /home/sam/Repositories/side/harbor-books",
    );
    expect(f.repos.searches).toEqual([{ roots: ["/home/sam/Repositories"], name: "harbor" }]);
  });

  it("uses the config's repoRoots, and says where it looked when nothing matches", async () => {
    const f = fakeDeps({ config: { ...fakeDeps().deps.config, repoRoots: ["/work"] } });
    expect(await findRepo(f.deps, coordinator, { name: "x" })).toBe(
      'No git repo named like "x" in /work. Ask the owner for the path.',
    );
  });
});
