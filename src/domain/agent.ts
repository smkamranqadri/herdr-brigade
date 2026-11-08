/** The agent programs brigade can run. */
const HARNESSES = ["claude", "codex", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

/** The three jobs in a brigade. */
const ROLES = ["coordinator", "captain", "worker"] as const;
export type Role = (typeof ROLES)[number];

/** How hard the model thinks. Each harness maps it onto its own flag. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * How freely an agent may run tools. ask: the owner approves commands in Herdr. auto: the harness approves
 * routine ones and stops on risky ones. bypass: no approval at all. Each harness maps it onto its own flags.
 */
const PERMISSIONS = ["ask", "auto", "bypass"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Which harness, model, effort and permission level one agent runs on. */
export interface AgentSpec {
  readonly harness: Harness;
  readonly model: string;
  readonly effort: Effort;
  readonly permissions: Permission;
}

/** Who an agent is in the brigade. Its MCP server gets this from its launcher. */
export interface AgentContext {
  readonly role: Role;
  /** Its own hc terminal address. */
  readonly terminal: string;
  readonly project: string | null;
  readonly task: string | null;
  readonly title: string | null;
  /** The terminal of the agent that started it: the Coordinator for a Captain, the Captain for a worker. */
  readonly parent: string | null;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isHarness = (value: unknown): value is Harness => isOneOf(HARNESSES, value);
export const isRole = (value: unknown): value is Role => isOneOf(ROLES, value);
export const isEffort = (value: unknown): value is Effort => isOneOf(EFFORTS, value);
export const isPermission = (value: unknown): value is Permission => isOneOf(PERMISSIONS, value);
