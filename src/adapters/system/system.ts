import { randomBytes } from "node:crypto";
import type { Clock, Ids } from "../../application/ports.ts";

const TASK_ID_BYTES = 3;

export const systemClock: Clock = {
  now: () => new Date(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
};

const hex = () => randomBytes(TASK_ID_BYTES).toString("hex");

export const randomIds: Ids = {
  taskId: () => `task-${hex()}`,
  noteId: () => `note-${hex()}`,
  suggestionId: () => `sugg-${hex()}`,
};
