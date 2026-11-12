import type { AgentSpec, Role } from "./agent.ts";

export type NoteSource = "owner" | "suggestion";
export type SuggestionOutcome = "accept" | "merge" | "reject";
export type PrState = "open" | "closed" | "merged";

/** One line of the brigade's event log. `at` is an ISO time from the injected clock. */
export type BrigadeEvent =
  | {
      readonly at: string;
      readonly kind: "agent_started";
      readonly role: Role;
      readonly project: string | null;
      readonly terminal: string;
      readonly spec: AgentSpec;
    }
  | {
      readonly at: string;
      readonly kind: "task_created";
      readonly project: string;
      readonly task: string;
      readonly title: string;
      readonly branch: string;
      readonly worktree: string;
      readonly terminal: string;
      readonly spec: AgentSpec;
      /** The project's repo and base branch when the task started (phase 2 on; older events lack them). */
      readonly repo?: string;
      readonly baseBranch?: string;
    }
  | {
      readonly at: string;
      /** A task's ended worker continued its conversation in a new terminal. */
      readonly kind: "worker_resumed";
      readonly project: string;
      readonly task: string;
      readonly terminal: string;
    }
  | {
      readonly at: string;
      readonly kind: "project_added";
      readonly project: string;
      readonly repo: string;
      readonly baseBranch: string;
      readonly github: string | null;
    }
  | { readonly at: string; readonly kind: "project_changed"; readonly project: string; readonly baseBranch: string }
  | {
      readonly at: string;
      readonly kind: "note_added";
      readonly note: string;
      readonly project: string;
      readonly text: string;
      /** owner: the owner's words, relayed by the Coordinator or a Captain. */
      readonly source: NoteSource;
      readonly task: string | null;
    }
  | {
      readonly at: string;
      readonly kind: "note_changed";
      readonly note: string;
      readonly project: string;
      readonly text: string;
    }
  | { readonly at: string; readonly kind: "note_removed"; readonly note: string; readonly project: string }
  | {
      readonly at: string;
      readonly kind: "note_suggested";
      readonly suggestion: string;
      readonly project: string;
      readonly task: string;
      readonly text: string;
      readonly why: string;
    }
  | {
      readonly at: string;
      readonly kind: "suggestion_resolved";
      readonly suggestion: string;
      readonly project: string;
      readonly outcome: SuggestionOutcome;
      readonly reason: string;
      /** accept: the new note's id; merge: the note it changed; reject: null. */
      readonly note: string | null;
      /** The note's text after an accept or a merge; null for a reject. */
      readonly text: string | null;
      /**
       * merge: the note's text the merge was based on. The merge applies only while the note still has it; otherwise
       * the suggestion stays open. Merges recorded before this field existed apply as they are.
       */
      readonly base?: string;
    }
  | {
      readonly at: string;
      readonly kind: "pr_opened";
      readonly task: string;
      /** The GitHub repo, owner/name. */
      readonly repo: string;
      readonly number: number;
      readonly url: string;
      readonly head: string;
      readonly base: string;
    }
  | {
      readonly at: string;
      readonly kind: "pr_state";
      readonly task: string;
      readonly number: number;
      readonly state: PrState;
      readonly headSha: string | null;
      readonly mergedAt: string | null;
    }
  | { readonly at: string; readonly kind: "task_finished"; readonly task: string; readonly summary: string }
  | { readonly at: string; readonly kind: "task_asked"; readonly task: string; readonly question: string }
  | {
      readonly at: string;
      readonly kind: "task_committed";
      readonly task: string;
      readonly sha: string;
      readonly message: string;
    }
  | {
      readonly at: string;
      readonly kind: "message_sent";
      readonly from: Role;
      readonly to: Role;
      readonly project: string | null;
      readonly task: string | null;
      readonly text: string;
    };

/** Every event shape without its time, for callers that let the log stamp it. */
export type NewEvent = BrigadeEvent extends infer E ? (E extends BrigadeEvent ? Omit<E, "at"> : never) : never;
