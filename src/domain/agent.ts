/** The agent programs brigade can run. */
const HARNESSES = ["claude", "codex", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

/** The three jobs in a brigade. */
const ROLES = ["coordinator", "captain", "worker"] as const;
export type Role = (typeof ROLES)[number];

/** How hard the model thinks. Each harness maps it onto its own flag. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isHarness = (value: unknown): value is Harness => isOneOf(HARNESSES, value);
export const isRole = (value: unknown): value is Role => isOneOf(ROLES, value);
export const isEffort = (value: unknown): value is Effort => isOneOf(EFFORTS, value);
