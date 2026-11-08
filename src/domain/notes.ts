import type { BrigadeEvent, NoteSource, SuggestionOutcome } from "./events.ts";

export interface Note {
  readonly id: string;
  readonly project: string;
  readonly text: string;
  readonly source: NoteSource;
  /** The task whose worker suggested it, for an accepted suggestion. */
  readonly task: string | null;
  readonly changedAt: string;
}

interface Suggestion {
  readonly id: string;
  readonly project: string;
  readonly task: string;
  readonly text: string;
  readonly why: string;
  readonly at: string;
  /** Null while open. */
  readonly outcome: SuggestionOutcome | null;
  readonly reason: string | null;
}

export interface ProjectNotes {
  /** Oldest first. */
  readonly notes: readonly Note[];
  readonly suggestions: readonly Suggestion[];
}

/** How much of a project's notes go into a worker's prompt. */
export interface NoteBudget {
  readonly maxNotes: number;
  readonly maxTokens: number;
}

const NOTE_BUDGET: NoteBudget = { maxNotes: 20, maxTokens: 2_000 };
/** A note is one short rule; a longer text is refused when it is written. */
export const MAX_NOTE_CHARS = 500;
const CHARS_PER_TOKEN = 4;

type Notes = Map<string, Note>;

function resolve(
  notes: Notes,
  suggestions: Map<string, Suggestion>,
  e: Extract<BrigadeEvent, { kind: "suggestion_resolved" }>,
): void {
  const s = suggestions.get(e.suggestion);
  // The first resolution wins: a retry or a race can't apply one twice.
  if (!s || s.outcome !== null) return;
  suggestions.set(e.suggestion, { ...s, outcome: e.outcome, reason: e.reason });
  if (e.note === null || e.text === null) return;
  if (e.outcome === "accept" && !notes.has(e.note)) {
    notes.set(e.note, {
      id: e.note,
      project: s.project,
      text: e.text,
      source: "suggestion",
      task: s.task,
      changedAt: e.at,
    });
  }
  const target = notes.get(e.note);
  if (e.outcome === "merge" && target) notes.set(e.note, { ...target, text: e.text, changedAt: e.at });
}

function applyNote(notes: Notes, e: BrigadeEvent): void {
  if (e.kind === "note_added") {
    notes.set(e.note, {
      id: e.note,
      project: e.project,
      text: e.text,
      source: e.source,
      task: e.task,
      changedAt: e.at,
    });
  }
  const n = e.kind === "note_changed" ? notes.get(e.note) : undefined;
  if (e.kind === "note_changed" && n) notes.set(e.note, { ...n, text: e.text, changedAt: e.at });
  if (e.kind === "note_removed") notes.delete(e.note);
}

function apply(notes: Notes, suggestions: Map<string, Suggestion>, e: BrigadeEvent): void {
  if (e.kind === "note_suggested" && !suggestions.has(e.suggestion)) {
    const { suggestion: id, project, task, text, why, at } = e;
    suggestions.set(id, { id, project, task, text, why, at, outcome: null, reason: null });
  } else if (e.kind === "suggestion_resolved") {
    resolve(notes, suggestions, e);
  } else {
    applyNote(notes, e);
  }
}

/** One project's notes and suggestions, folded from the event log. Events of other projects are ignored. */
export function deriveNotes(events: readonly BrigadeEvent[], project: string): ProjectNotes {
  const notes: Notes = new Map();
  const suggestions = new Map<string, Suggestion>();
  for (const e of events) if ("project" in e && e.project === project) apply(notes, suggestions, e);
  return { notes: [...notes.values()], suggestions: [...suggestions.values()] };
}

const tokensOf = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/** The newest notes that fit the budget, oldest first, and how many older ones were left out. */
export function notesForPrompt(
  notes: readonly Note[],
  budget: NoteBudget = NOTE_BUDGET,
): { shown: Note[]; hidden: number } {
  const shown: Note[] = [];
  let tokens = 0;
  for (const n of [...notes].reverse()) {
    if (shown.length >= budget.maxNotes || tokens + tokensOf(n.text) > budget.maxTokens) break;
    shown.unshift(n);
    tokens += tokensOf(n.text);
  }
  return { shown, hidden: notes.length - shown.length };
}

export function overBudget(notes: readonly Note[], budget: NoteBudget = NOTE_BUDGET): boolean {
  return notesForPrompt(notes, budget).hidden > 0;
}
