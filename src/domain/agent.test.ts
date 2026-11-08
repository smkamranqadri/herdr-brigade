import { describe, expect, it } from "vitest";
import { isEffort, isHarness, isRole } from "./agent.ts";

describe("isHarness", () => {
  it.each(["claude", "codex", "pi"])("accepts %s", (name) => {
    expect(isHarness(name)).toBe(true);
  });

  it.each(["Claude", "cursor", "", 1, null, undefined])("rejects %s", (value) => {
    expect(isHarness(value)).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts the three roles and nothing else", () => {
    expect(["coordinator", "captain", "worker", "chef"].map(isRole)).toEqual([true, true, true, false]);
  });
});

describe("isEffort", () => {
  it("accepts the five levels and nothing else", () => {
    expect(["low", "medium", "high", "xhigh", "max", "minimal"].map(isEffort)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});
