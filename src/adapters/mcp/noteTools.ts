// The MCP tools for project notes: workers suggest and read, Captains curate, the Coordinator saves the owner's rules.
import {
  addNote,
  changeNote,
  listSuggestions,
  readNotes,
  removeNote,
  resolveSuggestion,
  saveNote,
  suggestNote,
} from "../../application/notes.ts";
import type { Deps } from "../../application/ports.ts";
import type { AgentContext } from "../../domain/agent.ts";
import { BrigadeError } from "../../domain/errors.ts";
import type { SuggestionOutcome } from "../../domain/events.ts";
import { optStr, schema, str, type Args } from "./args.ts";
import type { Tool } from "./protocol.ts";

const OUTCOMES: readonly SuggestionOutcome[] = ["accept", "merge", "reject"];

function outcome(args: Args): SuggestionOutcome {
  const v = str(args, "outcome");
  const found = OUTCOMES.find((o) => o === v);
  if (!found) throw new BrigadeError(`"outcome" must be accept, merge or reject.`);
  return found;
}

export function workerNoteTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    suggest_note: {
      description:
        "Propose a lasting project note for your Captain to accept or reject when your task ends: a preference or fact that isn't in the code. Not run logs; not code conventions.",
      inputSchema: schema(["text", "why"], {
        text: "One short rule.",
        why: "What a future agent would get wrong without it.",
      }),
      run: (a) => suggestNote(deps, ctx, { text: str(a, "text"), why: str(a, "why") }),
    },
    read_notes: {
      description: "Every note of your project, including older ones your prompt left out.",
      inputSchema: schema([], {}),
      run: () => readNotes(deps, ctx),
    },
  };
}

function resolveTool(deps: Deps, ctx: AgentContext): Tool {
  return {
    description:
      "Settle one suggestion: accept it as a note, merge it into an existing note, or reject it. Give a one-line reason.",
    inputSchema: schema(["suggestion", "outcome", "reason"], {
      suggestion: "Suggestion id, e.g. sugg-a1b2c3.",
      outcome: "accept, merge or reject.",
      reason: "One line: why.",
      note: "For merge: the note to merge into.",
      text: "For accept: the note's final text (default: as suggested). For merge: the merged text.",
    }),
    run: (a) => {
      const [note, text] = [optStr(a, "note"), optStr(a, "text")];
      return resolveSuggestion(deps, ctx, {
        suggestion: str(a, "suggestion"),
        outcome: outcome(a),
        reason: str(a, "reason"),
        ...(note && { note }),
        ...(text && { text }),
      });
    },
  };
}

export function captainNoteTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    list_notes: { description: "This project's notes.", inputSchema: schema([], {}), run: () => readNotes(deps, ctx) },
    add_note: {
      description: "Save a lasting rule the owner gave for this project.",
      inputSchema: schema(["text"], { text: "One short rule, in the owner's sense." }),
      run: (a) => addNote(deps, ctx, { text: str(a, "text") }),
    },
    change_note: {
      description: "Rewrite one note.",
      inputSchema: schema(["note", "text"], { note: "Note id, e.g. note-a1b2c3.", text: "The new text." }),
      run: (a) => changeNote(deps, ctx, { note: str(a, "note"), text: str(a, "text") }),
    },
    remove_note: {
      description: "Remove one note.",
      inputSchema: schema(["note"], { note: "Note id." }),
      run: (a) => removeNote(deps, ctx, { note: str(a, "note") }),
    },
    list_suggestions: {
      description: "Workers' open note suggestions in this project.",
      inputSchema: schema([], {}),
      run: () => listSuggestions(deps, ctx),
    },
    resolve_suggestion: resolveTool(deps, ctx),
  };
}

export function coordinatorNoteTools(deps: Deps, ctx: AgentContext): Record<string, Tool> {
  return {
    save_note: {
      description: "Save a lasting rule the owner gave for one project. Every later worker there starts with it.",
      inputSchema: schema(["project", "text"], {
        project: "The project.",
        text: "One short rule, in the owner's sense.",
      }),
      run: (a) => saveNote(deps, ctx, { project: str(a, "project"), text: str(a, "text") }),
    },
  };
}
