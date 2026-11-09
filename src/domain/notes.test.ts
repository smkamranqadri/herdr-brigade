import { describe, expect, it } from "vitest";
import type { BrigadeEvent } from "./events.ts";
import { deriveNotes, notesForPrompt, overBudget, type Note } from "./notes.ts";

const added = (note: string, text: string, at = "1", project = "shop"): BrigadeEvent => ({
  at,
  kind: "note_added",
  note,
  project,
  text,
  source: "owner",
  task: null,
});
const suggested = (suggestion: string, text: string): BrigadeEvent => ({
  at: "2",
  kind: "note_suggested",
  suggestion,
  project: "shop",
  task: "task-1",
  text,
  why: "w",
});
const resolved = (
  suggestion: string,
  outcome: "accept" | "merge" | "reject",
  note: string | null,
  text: string | null,
  at = "3",
): BrigadeEvent => ({
  at,
  kind: "suggestion_resolved",
  suggestion,
  project: "shop",
  outcome,
  reason: "r",
  note,
  text,
});

describe("deriveNotes", () => {
  it("adds, changes and removes notes, and ignores other projects", () => {
    const { notes } = deriveNotes(
      [
        added("n1", "Urdu first"),
        added("n2", "No QR codes"),
        added("n9", "Other project", "1", "blog"),
        { at: "4", kind: "note_changed", note: "n1", project: "shop", text: "Urdu first, then English" },
        { at: "5", kind: "note_removed", note: "n2", project: "shop" },
      ],
      "shop",
    );
    expect(notes).toEqual([
      { id: "n1", project: "shop", text: "Urdu first, then English", source: "owner", task: null, changedAt: "4" },
    ]);
  });

  it("turns an accepted suggestion into a note, merges another, rejects a third", () => {
    const { notes, suggestions } = deriveNotes(
      [
        added("n1", "Little text"),
        suggested("s1", "White space"),
        suggested("s2", "Less text"),
        suggested("s3", "Run npm test"),
        resolved("s1", "accept", "n2", "Lots of white space"),
        resolved("s2", "merge", "n1", "Little text, less of it"),
        resolved("s3", "reject", null, null),
      ],
      "shop",
    );
    expect(notes.map((n) => [n.id, n.text, n.source, n.task])).toEqual([
      ["n1", "Little text, less of it", "owner", null],
      ["n2", "Lots of white space", "suggestion", "task-1"],
    ]);
    expect(suggestions.map((s) => [s.id, s.outcome])).toEqual([
      ["s1", "accept"],
      ["s2", "merge"],
      ["s3", "reject"],
    ]);
  });

  it("applies a merge only while its note still has the text it was based on; otherwise the suggestion stays open", () => {
    const merge = (base: string | undefined, at: string): BrigadeEvent => ({
      ...resolved("s1", "merge", "n1", "Merged text", at),
      ...(base === undefined ? {} : { base }),
    });
    const changed: BrigadeEvent = { at: "4", kind: "note_changed", note: "n1", project: "shop", text: "Corrected" };
    const lost = deriveNotes(
      [added("n1", "Little text"), suggested("s1", "Less"), changed, merge("Little text", "5")],
      "shop",
    );
    expect(lost.notes.map((n) => n.text)).toEqual(["Corrected"]);
    expect(lost.suggestions.map((s) => s.outcome)).toEqual([null]);
    const removed: BrigadeEvent = { at: "4", kind: "note_removed", note: "n1", project: "shop" };
    const gone = deriveNotes(
      [added("n1", "Little text"), suggested("s1", "Less"), removed, merge("Little text", "5")],
      "shop",
    );
    expect(gone.suggestions.map((s) => s.outcome)).toEqual([null]);
    const fits = deriveNotes(
      [added("n1", "Little text"), suggested("s1", "Less"), changed, merge("Corrected", "5")],
      "shop",
    );
    expect(fits.notes.map((n) => n.text)).toEqual(["Merged text"]);
    const old = deriveNotes(
      [added("n1", "Little text"), suggested("s1", "Less"), changed, merge(undefined, "5")],
      "shop",
    );
    expect(old.notes.map((n) => n.text)).toEqual(["Merged text"]);
  });

  it("applies only the first resolution of a suggestion, so a retry or race can't add a note twice", () => {
    const { notes, suggestions } = deriveNotes(
      [
        suggested("s1", "White space"),
        resolved("s1", "accept", "n2", "A"),
        resolved("s1", "accept", "n3", "B"),
        resolved("s1", "reject", null, null),
      ],
      "shop",
    );
    expect(notes.map((n) => [n.id, n.text])).toEqual([["n2", "A"]]);
    expect(suggestions[0]?.outcome).toBe("accept");
  });
});

describe("notesForPrompt", () => {
  const note = (i: number, text = `note ${i}`): Note => ({
    id: `n${i}`,
    project: "shop",
    text,
    source: "owner",
    task: null,
    changedAt: String(i),
  });

  it("keeps the newest notes that fit the count, oldest first, and counts the rest", () => {
    const notes = Array.from({ length: 5 }, (_, i) => note(i));
    expect(notesForPrompt(notes, { maxNotes: 3, maxTokens: 1_000 })).toEqual({
      shown: [note(2), note(3), note(4)],
      hidden: 2,
    });
    expect(overBudget(notes, { maxNotes: 3, maxTokens: 1_000 })).toBe(true);
    expect(overBudget(notes, { maxNotes: 5, maxTokens: 1_000 })).toBe(false);
  });

  it("stops at the token budget too", () => {
    const notes = [note(1, "x".repeat(40)), note(2, "y".repeat(40))];
    expect(notesForPrompt(notes, { maxNotes: 20, maxTokens: 15 })).toEqual({ shown: [notes[1]], hidden: 1 });
  });
});
