import type { AgentSpec, Role } from "./agent.ts";

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
