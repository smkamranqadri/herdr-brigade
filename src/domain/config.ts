import { isEffort, isHarness, type AgentSpec, type Role } from "./agent.ts";

export interface ProjectConfig {
  readonly name: string;
  /** Absolute path of the project's git repo. */
  readonly repo: string;
  readonly baseBranch: string;
}

export interface BrigadeConfig {
  /** The owner's name, used in prompts. */
  readonly owner: string;
  readonly roles: Readonly<Record<Role, AgentSpec>>;
  readonly projects: readonly ProjectConfig[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const NAME = /^[a-z0-9][a-z0-9-]{0,23}$/;
const ROLE_KEYS: readonly Role[] = ["coordinator", "captain", "worker"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function parseSpec(raw: unknown, where: string, errors: string[]): AgentSpec | null {
  if (!isObj(raw)) {
    errors.push(`${where} must be an object with harness, model and effort`);
    return null;
  }
  const { harness, model, effort } = raw;
  if (!isHarness(harness)) errors.push(`${where}.harness must be claude, codex or pi`);
  if (!isText(model)) errors.push(`${where}.model must be a model name`);
  if (!isEffort(effort)) errors.push(`${where}.effort must be low, medium, high, xhigh or max`);
  return isHarness(harness) && isText(model) && isEffort(effort) ? { harness, model, effort } : null;
}

function parseProject(raw: unknown, i: number, errors: string[]): ProjectConfig | null {
  const where = `projects[${i}]`;
  if (!isObj(raw)) {
    errors.push(`${where} must be an object with name, repo and baseBranch`);
    return null;
  }
  const { name, repo, baseBranch } = raw;
  const nameOk = typeof name === "string" && NAME.test(name);
  const repoOk = typeof repo === "string" && repo.startsWith("/");
  if (!nameOk) errors.push(`${where}.name must be 1-24 of a-z, 0-9 and -`);
  if (!repoOk) errors.push(`${where}.repo must be an absolute path`);
  if (!isText(baseBranch)) errors.push(`${where}.baseBranch must be a branch name`);
  return nameOk && repoOk && isText(baseBranch) ? { name, repo, baseBranch } : null;
}

function parseRoles(raw: unknown, errors: string[]): Record<Role, AgentSpec> | null {
  if (!isObj(raw)) {
    errors.push("roles must have coordinator, captain and worker");
    return null;
  }
  const specs = ROLE_KEYS.map((role) => [role, parseSpec(raw[role], `roles.${role}`, errors)] as const);
  return specs.every(([, spec]) => spec !== null) ? (Object.fromEntries(specs) as Record<Role, AgentSpec>) : null;
}

/** Checks a config file's parsed JSON. Lists every problem, not only the first. */
export function parseConfig(raw: unknown): ParseResult<BrigadeConfig> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["the config must be a JSON object"] };
  if (!isText(raw.owner)) errors.push("owner must be your name");
  const roles = parseRoles(raw.roles, errors);
  const list = Array.isArray(raw.projects) ? raw.projects : [];
  if (!Array.isArray(raw.projects)) errors.push("projects must be a list");
  const projects = list.flatMap((p: unknown, i) => parseProject(p, i, errors) ?? []);
  const names = projects.map((p) => p.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) errors.push(`project names must be unique: ${[...new Set(twice)].join(", ")}`);
  if (errors.length || !roles || !isText(raw.owner)) return { ok: false, errors };
  return { ok: true, value: { owner: raw.owner, roles, projects } };
}
