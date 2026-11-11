import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Clock, Folders, Ids } from "../../application/ports.ts";

const TASK_ID_BYTES = 3;

export const systemClock: Clock = {
  now: () => new Date(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
};

export const localFolders: Folders = {
  ensure: async (folder) => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
  },
};

const hex = () => randomBytes(TASK_ID_BYTES).toString("hex");

export const randomIds: Ids = {
  taskId: () => `task-${hex()}`,
  noteId: () => `note-${hex()}`,
  suggestionId: () => `sugg-${hex()}`,
};
