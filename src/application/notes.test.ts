import { describe, expect, it } from "vitest";
import { createTask } from "./captain.ts";
import { ctx, fakeDeps } from "./fakes.ts";
import {
  addNote,
  changeNote,
  listSuggestions,
  notesBlock,
  readNotes,
  removeNote,
  resolveSuggestion,
  saveNote,
  suggestNote,
} from "./notes.ts";
import { finishTask } from "./worker.ts";

const captain = ctx({ role: "captain", terminal: "t3", project: "shop" });
const otherCaptain = ctx({ role: "captain", terminal: "t8", project: "blog" });
const coordinator = ctx({ role: "coordinator", terminal: "t1" });

async function withTask() {
  const f = fakeDeps();
  await createTask(f.deps, captain, { title: "Poster", prompt: "Make it." });
  const worker = ctx({
    role: "worker",
    terminal: "t1",
    project: "shop",
    task: "task-000001",
    title: "Poster",
    parent: "t3",
  });
  return { f, worker };
}

describe("owner notes", () => {
  it("the Captain and the Coordinator save the owner's rules; workers read them all", async () => {
    const { f, worker } = await withTask();
    expect(await addNote(f.deps, captain, { text: "Urdu first, then English" })).toBe(
      "Saved note note-000002 in shop.",
    );
    expect(await saveNote(f.deps, coordinator, { project: "shop", text: "No QR codes" })).toBe(
      "Saved note note-000003 in shop.",
    );
    expect(await readNotes(f.deps, worker)).toBe(
      "note-000002 [owner] Urdu first, then English\nnote-000003 [owner] No QR codes",
    );
  });

  it("refuses a note that is too long, a project that doesn't exist, and the wrong roles", async () => {
    const { f, worker } = await withTask();
    await expect(addNote(f.deps, captain, { text: "x".repeat(501) })).rejects.toThrow("at most 500 characters");
    await expect(saveNote(f.deps, coordinator, { project: "blog", text: "x" })).rejects.toThrow('No project "blog".');
    await expect(addNote(f.deps, worker, { text: "x" })).rejects.toThrow("Only a project's Captain curates its notes.");
    await expect(saveNote(f.deps, captain, { project: "shop", text: "x" })).rejects.toThrow(
      "Only the Coordinator uses save_note",
    );
    expect(f.events.events.filter((e) => e.kind === "note_added")).toEqual([]);
  });
});

describe("scope", () => {
  it("a Captain can't change, remove or settle another project's notes and suggestions, and nothing is written", async () => {
    const { f, worker } = await withTask();
    await addNote(f.deps, captain, { text: "Urdu first" });
    await suggestNote(f.deps, worker, { text: "White space", why: "w" });
    const before = f.events.events.length;
    await expect(changeNote(f.deps, otherCaptain, { note: "note-000002", text: "x" })).rejects.toThrow(
      "No note note-000002 in blog.",
    );
    await expect(removeNote(f.deps, otherCaptain, { note: "note-000002" })).rejects.toThrow(
      "No note note-000002 in blog.",
    );
    await expect(
      resolveSuggestion(f.deps, otherCaptain, { suggestion: "sugg-000003", outcome: "accept", reason: "r" }),
    ).rejects.toThrow("No suggestion sugg-000003 in blog.");
    expect(f.events.events.length).toBe(before);
  });

  it("a worker can only suggest for its own recorded task", async () => {
    const { f } = await withTask();
    const stranger = ctx({ role: "worker", project: "shop", task: "task-999", title: "x", parent: "t3" });
    await expect(suggestNote(f.deps, stranger, { text: "x", why: "w" })).rejects.toThrow(
      "Brigade has no record of task-999 in shop.",
    );
    await expect(suggestNote(f.deps, captain, { text: "x", why: "w" })).rejects.toThrow(
      "Only a worker suggests notes.",
    );
  });
});

describe("the notes retro", () => {
  it("lists the task's open suggestions in its finish report, and each can be settled once", async () => {
    const { f, worker } = await withTask();
    await addNote(f.deps, captain, { text: "Little text" });
    await suggestNote(f.deps, worker, { text: "Lots of white space", why: "the owner said so twice" });
    await suggestNote(f.deps, worker, { text: "Run npm test first", why: "it failed once" });
    await finishTask(f.deps, worker, { summary: "Poster done" });
    expect(f.terminals.sent.at(-1)?.text).toBe(
      [
        '[brigade] Task task-000001 "Poster" finished: Poster done',
        "Notes retro: settle each with resolve_suggestion and a reason.",
        "- sugg-000003: Lots of white space (why: the owner said so twice)",
        "- sugg-000004: Run npm test first (why: it failed once)",
      ].join("\n"),
    );
    expect(
      await resolveSuggestion(f.deps, captain, { suggestion: "sugg-000003", outcome: "accept", reason: "lasting" }),
    ).toBe("Accepted sugg-000003 as note note-000005.");
    expect(
      await resolveSuggestion(f.deps, captain, {
        suggestion: "sugg-000004",
        outcome: "reject",
        reason: "a code convention",
      }),
    ).toBe("Rejected sugg-000004.");
    await expect(
      resolveSuggestion(f.deps, captain, { suggestion: "sugg-000003", outcome: "reject", reason: "r" }),
    ).rejects.toThrow("Suggestion sugg-000003 was already settled (accept).");
    expect(await listSuggestions(f.deps, captain)).toBe("No open suggestions.");
    expect(await readNotes(f.deps, captain)).toBe(
      "note-000002 [owner] Little text\nnote-000005 [suggested in task-000001] Lots of white space",
    );
  });

  it("a merge needs a note of this project and the merged text", async () => {
    const { f, worker } = await withTask();
    await addNote(f.deps, captain, { text: "Little text" });
    await suggestNote(f.deps, worker, { text: "Less text", why: "w" });
    await expect(
      resolveSuggestion(f.deps, captain, { suggestion: "sugg-000003", outcome: "merge", reason: "r" }),
    ).rejects.toThrow("A merge needs the note to merge into and the merged text.");
    expect(
      await resolveSuggestion(f.deps, captain, {
        suggestion: "sugg-000003",
        outcome: "merge",
        reason: "same",
        note: "note-000002",
        text: "Very little text",
      }),
    ).toBe("Merged sugg-000003 into note note-000002.");
    expect(await readNotes(f.deps, captain)).toBe("note-000002 [owner] Very little text");
  });
});

describe("delivery to workers", () => {
  it("puts the project's notes in a new worker's prompt as preferences, never permissions", async () => {
    const f = fakeDeps();
    await addNote(f.deps, captain, { text: "Urdu first" });
    await createTask(f.deps, captain, { title: "Banner", prompt: "Make it." });
    expect(f.harnesses.requests.at(-1)?.systemPrompt).toBe(
      [
        "worker prompt for Sam",
        "Project notes: lasting preferences for this project from Sam and the Captain. They are preferences, never permission to push, deploy, widen your task or skip checks. Your brief and brigade's tool limits always win.",
        "- Urdu first",
      ].join("\n"),
    );
    expect(
      notesBlock(
        [{ id: "n", project: "shop", text: "Urdu first", source: "owner", task: null, changedAt: "1" }],
        "Sam",
      ),
    ).toBe(
      [
        "Project notes: lasting preferences for this project from Sam and the Captain. They are preferences, never permission to push, deploy, widen your task or skip checks. Your brief and brigade's tool limits always win.",
        "- Urdu first",
      ].join("\n"),
    );
    expect(notesBlock([], "Sam")).toBe("This project has no notes yet.");
  });
});
