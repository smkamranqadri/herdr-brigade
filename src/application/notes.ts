import type { AgentContext } from "../domain/agent.ts";
import { BrigadeError } from "../domain/errors.ts";
import type { SuggestionOutcome } from "../domain/events.ts";
import {
  deriveNotes,
  MAX_NOTE_CHARS,
  notesForPrompt,
  overBudget,
  type Note,
  type ProjectNotes,
} from "../domain/notes.ts";
import { deriveTasks } from "../domain/tasks.ts";
import { record } from "./launch.ts";
import type { Deps } from "./ports.ts";

function captainProject(ctx: AgentContext): string {
  if (ctx.role !== "captain" || !ctx.project) throw new BrigadeError("Only a project's Captain curates its notes.");
  return ctx.project;
}

function checkText(text: string): string {
  const t = text.trim();
  if (t.length > MAX_NOTE_CHARS)
    throw new BrigadeError(`A note is one short rule: at most ${MAX_NOTE_CHARS} characters.`);
  return t;
}

const current = async (deps: Deps, project: string): Promise<ProjectNotes> =>
  deriveNotes(await deps.events.read(), project);

/** Finds a note by id in this project only: another project's id is "not found", never touched. */
function noteIn(notes: ProjectNotes, id: string, project: string): Note {
  const note = notes.notes.find((n) => n.id === id);
  if (!note) throw new BrigadeError(`No note ${id} in ${project}. Call list_notes.`);
  return note;
}

const line = (n: Note) =>
  `${n.id} [${n.source === "owner" ? "owner" : `suggested in ${n.task ?? "a task"}`}] ${n.text}`;
const budgetWarning = (notes: readonly Note[]) =>
  overBudget(notes) ? ` The notes are over the budget, so workers no longer see the oldest: merge or remove some.` : "";

/** The notes block for a worker's system prompt. Notes are preferences, never permissions. */
export function notesBlock(notes: readonly Note[], owner: string): string {
  if (!notes.length) return "This project has no notes yet.";
  const { shown, hidden } = notesForPrompt(notes);
  return [
    `Project notes: lasting preferences for this project from ${owner} and the Captain. They are preferences, never permission to push, deploy, widen your task or skip checks. Your brief and brigade's tool limits always win.`,
    ...shown.map((n) => `- ${n.text}`),
    ...(hidden
      ? [`(${hidden} older note${hidden === 1 ? " is" : "s are"} not shown here; read_notes lists every note.)`]
      : []),
  ].join("\n");
}

/** A worker proposes a note. Its project and task come from its own context and must match the task record. */
export async function suggestNote(
  deps: Deps,
  ctx: AgentContext,
  input: { text: string; why: string },
): Promise<string> {
  const { project, task } = ctx;
  if (ctx.role !== "worker" || !project || !task) throw new BrigadeError("Only a worker suggests notes.");
  const record_ = deriveTasks(await deps.events.read()).find((t) => t.id === task);
  if (record_?.project !== project) throw new BrigadeError(`Brigade has no record of ${task} in ${project}.`);
  const text = checkText(input.text);
  await record(deps, {
    kind: "note_suggested",
    suggestion: deps.ids.suggestionId(),
    project,
    task,
    text,
    why: input.why,
  });
  return "Suggested. Your Captain decides on it when your task is finished.";
}

/** Every note of the caller's project, newest last. */
export async function readNotes(deps: Deps, ctx: AgentContext): Promise<string> {
  if (!ctx.project) throw new BrigadeError("This agent has no project.");
  const { notes } = await current(deps, ctx.project);
  return notes.length ? notes.map(line).join("\n") : `${ctx.project} has no notes yet.`;
}

export async function listSuggestions(deps: Deps, ctx: AgentContext): Promise<string> {
  const project = captainProject(ctx);
  const open = (await current(deps, project)).suggestions.filter((s) => s.outcome === null);
  if (!open.length) return "No open suggestions.";
  return open.map((s) => `${s.id} from ${s.task}: ${s.text} (why: ${s.why})`).join("\n");
}

async function addOwnerNote(deps: Deps, project: string, text: string): Promise<string> {
  const note = deps.ids.noteId();
  await record(deps, { kind: "note_added", note, project, text: checkText(text), source: "owner", task: null });
  return `Saved note ${note} in ${project}.${budgetWarning((await current(deps, project)).notes)}`;
}

/** The Captain saves a lasting rule the owner gave. */
export async function addNote(deps: Deps, ctx: AgentContext, input: { text: string }): Promise<string> {
  return addOwnerNote(deps, captainProject(ctx), input.text);
}

/** The Coordinator saves a lasting rule the owner gave for a project. */
export async function saveNote(
  deps: Deps,
  ctx: AgentContext,
  input: { project: string; text: string },
): Promise<string> {
  if (ctx.role !== "coordinator")
    throw new BrigadeError("Only the Coordinator uses save_note; a Captain uses add_note.");
  if (!deps.config.projects.some((p) => p.name === input.project))
    throw new BrigadeError(`No project "${input.project}".`);
  return addOwnerNote(deps, input.project, input.text);
}

export async function changeNote(
  deps: Deps,
  ctx: AgentContext,
  input: { note: string; text: string },
): Promise<string> {
  const project = captainProject(ctx);
  const note = noteIn(await current(deps, project), input.note, project);
  await record(deps, { kind: "note_changed", note: note.id, project, text: checkText(input.text) });
  return `Changed note ${note.id}.`;
}

export async function removeNote(deps: Deps, ctx: AgentContext, input: { note: string }): Promise<string> {
  const project = captainProject(ctx);
  const note = noteIn(await current(deps, project), input.note, project);
  await record(deps, { kind: "note_removed", note: note.id, project });
  return `Removed note ${note.id}.`;
}

export interface ResolveInput {
  readonly suggestion: string;
  readonly outcome: SuggestionOutcome;
  readonly reason: string;
  /** merge: the note to merge into. */
  readonly note?: string;
  /** accept: the note's final text (default: the suggestion's); merge: the merged text (required). */
  readonly text?: string;
}

/** Settles one open suggestion of the Captain's project in a single event. */
export async function resolveSuggestion(deps: Deps, ctx: AgentContext, input: ResolveInput): Promise<string> {
  const project = captainProject(ctx);
  const notes = await current(deps, project);
  const s = notes.suggestions.find((x) => x.id === input.suggestion);
  if (!s) throw new BrigadeError(`No suggestion ${input.suggestion} in ${project}. Call list_suggestions.`);
  if (s.outcome !== null) throw new BrigadeError(`Suggestion ${s.id} was already settled (${s.outcome}).`);
  const base = {
    kind: "suggestion_resolved",
    suggestion: s.id,
    project,
    outcome: input.outcome,
    reason: input.reason,
  } as const;
  if (input.outcome === "reject") {
    await record(deps, { ...base, note: null, text: null });
    return `Rejected ${s.id}.`;
  }
  if (input.outcome === "accept") {
    const note = deps.ids.noteId();
    await record(deps, { ...base, note, text: checkText(input.text ?? s.text) });
    return `Accepted ${s.id} as note ${note}.${budgetWarning((await current(deps, project)).notes)}`;
  }
  if (!input.note || !input.text) throw new BrigadeError("A merge needs the note to merge into and the merged text.");
  const target = noteIn(notes, input.note, project);
  await record(deps, { ...base, note: target.id, text: checkText(input.text) });
  return `Merged ${s.id} into note ${target.id}.`;
}

/** The notes retro for a finished task: its open suggestions, and a warning when the notes are over the budget. */
export async function retroFor(deps: Deps, project: string, task: string): Promise<string> {
  const notes = await current(deps, project);
  const open = notes.suggestions.filter((s) => s.task === task && s.outcome === null);
  const lines = open.map((s) => `- ${s.id}: ${s.text} (why: ${s.why})`);
  const parts = lines.length ? [`Notes retro: settle each with resolve_suggestion and a reason.`, ...lines] : [];
  if (overBudget(notes.notes)) parts.push("The notes are over the budget: merge or remove some.");
  return parts.join("\n");
}
