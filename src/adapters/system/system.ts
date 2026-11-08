import { randomBytes } from "node:crypto";
import type { Clock, Ids } from "../../application/ports.ts";

const TASK_ID_BYTES = 3;

export const systemClock: Clock = { now: () => new Date() };

export const randomIds: Ids = { taskId: () => `task-${randomBytes(TASK_ID_BYTES).toString("hex")}` };
