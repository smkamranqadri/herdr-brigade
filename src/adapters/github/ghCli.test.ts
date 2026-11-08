import { describe, expect, it } from "vitest";
import { GhCli } from "./ghCli.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  number: 7,
  url: "https://github.com/acme/shop/pull/7",
  state: "OPEN",
  headRefName: "brigade/login-1",
  baseRefName: "main",
  headRefOid: "abc123",
  mergedAt: "",
  ...over,
});

function scripted(replies: Record<string, string>) {
  const calls: string[][] = [];
  const gh = new GhCli((args) => {
    calls.push([...args]);
    return Promise.resolve(replies[`${args[0] ?? ""} ${args[1] ?? ""}`] ?? "");
  });
  return { gh, calls };
}

const FIELDS = "number,url,state,headRefName,baseRefName,headRefOid,mergedAt";

describe("GhCli", () => {
  it("lists a branch's PRs in every state, naming the repo and head", async () => {
    const { gh, calls } = scripted({
      "pr list": JSON.stringify([raw(), raw({ number: 3, state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" })]),
    });
    expect(await gh.pullRequestsFor("acme/shop", "brigade/login-1")).toEqual([
      {
        number: 7,
        url: "https://github.com/acme/shop/pull/7",
        state: "open",
        head: "brigade/login-1",
        base: "main",
        headSha: "abc123",
        mergedAt: null,
      },
      {
        number: 3,
        url: "https://github.com/acme/shop/pull/7",
        state: "merged",
        head: "brigade/login-1",
        base: "main",
        headSha: "abc123",
        mergedAt: "2026-11-01T00:00:00Z",
      },
    ]);
    expect(calls).toEqual([
      [
        "pr",
        "list",
        "--repo",
        "acme/shop",
        "--head",
        "brigade/login-1",
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        FIELDS,
      ],
    ]);
  });

  it("creates with explicit repo, head and base, then reads the new PR", async () => {
    const { gh, calls } = scripted({
      "pr create": "https://github.com/acme/shop/pull/7",
      "pr view": JSON.stringify(raw()),
    });
    expect(
      (await gh.create("acme/shop", { head: "brigade/login-1", base: "main", title: "T", body: "B" })).number,
    ).toBe(7);
    expect(calls).toEqual([
      [
        "pr",
        "create",
        "--repo",
        "acme/shop",
        "--head",
        "brigade/login-1",
        "--base",
        "main",
        "--title",
        "T",
        "--body",
        "B",
      ],
      ["pr", "view", "7", "--repo", "acme/shop", "--json", FIELDS],
    ]);
  });

  it("edits only the title and body", async () => {
    const { gh, calls } = scripted({});
    await gh.edit("acme/shop", 7, { title: "T", body: "B" });
    expect(calls).toEqual([["pr", "edit", "7", "--repo", "acme/shop", "--title", "T", "--body", "B"]]);
  });

  it("fails loudly on output it can't read", async () => {
    await expect(
      scripted({ "pr view": JSON.stringify(raw({ state: "DRAFTY" })) }).gh.view("acme/shop", 7),
    ).rejects.toThrow("gh returned a pull request brigade can't read");
    await expect(
      scripted({ "pr create": "Warning: something" }).gh.create("acme/shop", {
        head: "h",
        base: "b",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow("gh pr create didn't print the new pull request's URL");
  });
});
