import { isEffort, isHarness, isPermission, type AgentSpec, type Permission, type Role } from "./agent.ts";
import { BrigadeError } from "./errors.ts";
import { isGithubRepo } from "./github.ts";

export interface ProjectConfig {
  readonly name: string;
  /** Absolute path of the project's git repo. */
  readonly repo: string;
  readonly baseBranch: string;
  /** The GitHub repo (`owner/name`) this project publishes to, pinned when it was added; null: no publishing. */
  readonly github: string | null;
}

export interface BrigadeConfig {
  /** The owner's name, used in prompts. */
  readonly owner: string;
  readonly roles: Readonly<Record<Role, AgentSpec>>;
  /** Folders find_repo searches; null: the default the edge supplies. */
  readonly repoRoots: readonly string[] | null;
  readonly projects: readonly ProjectConfig[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const NAME = /^[a-z0-9][a-z0-9-]{0,23}$/;
const ROLE_KEYS: readonly Role[] = ["coordinator", "captain", "worker"];

/** Workers run hands-off by default; the Coordinator and Captains only route work, so they ask. */
const DEFAULT_PERMISSIONS: Readonly<Record<Role, Permission>> = { coordinator: "ask", captain: "ask", worker: "auto" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function parsePermission(raw: unknown, role: Role, errors: string[]): Permission | null {
  const permissions = raw ?? DEFAULT_PERMISSIONS[role];
  if (isPermission(permissions)) return permissions;
  errors.push(`roles.${role}.permissions must be ask, auto or bypass`);
  return null;
}

function parseSpec(raw: unknown, role: Role, errors: string[]): AgentSpec | null {
  const where = `roles.${role}`;
  if (!isObj(raw)) {
    errors.push(`${where} must be an object with harness, model and effort`);
    return null;
  }
  const { harness, model, effort } = raw;
  if (!isHarness(harness)) errors.push(`${where}.harness must be claude, codex or pi`);
  if (!isText(model)) errors.push(`${where}.model must be a model name`);
  if (!isEffort(effort)) errors.push(`${where}.effort must be low, medium, high, xhigh or max`);
  const permissions = parsePermission(raw.permissions, role, errors);
  const ok = isHarness(harness) && isText(model) && isEffort(effort) && permissions;
  return ok ? { harness, model, effort, permissions } : null;
}

function parseProject(raw: unknown, i: number, errors: string[]): ProjectConfig | null {
  const where = `projects[${i}]`;
  if (!isObj(raw)) {
    errors.push(`${where} must be an object with name, repo and baseBranch`);
    return null;
  }
  const { name, repo, baseBranch } = raw;
  const github = raw.github ?? null;
  const checks: readonly [boolean, string][] = [
    [typeof name === "string" && NAME.test(name), `${where}.name must be 1-24 of a-z, 0-9 and -`],
    [typeof repo === "string" && repo.startsWith("/"), `${where}.repo must be an absolute path`],
    [isText(baseBranch), `${where}.baseBranch must be a branch name`],
    [github === null || isGithubRepo(github), `${where}.github must be owner/name on GitHub`],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
  errors.push(...failed);
  return failed.length === 0 ? asProject(name, repo, baseBranch, github) : null;
}

/** The checked fields as a project; only called once every check passed. */
function asProject(name: unknown, repo: unknown, baseBranch: unknown, github: unknown): ProjectConfig | null {
  const ok = typeof name === "string" && typeof repo === "string" && typeof baseBranch === "string";
  return ok ? { name, repo, baseBranch, github: isGithubRepo(github) ? github : null } : null;
}

function parseRepoRoots(raw: unknown, errors: string[]): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw) && raw.every((r): r is string => typeof r === "string" && r.startsWith("/"))) return raw;
  errors.push("repoRoots must be a list of absolute paths");
  return null;
}

function parseRoles(raw: unknown, errors: string[]): Record<Role, AgentSpec> | null {
  if (!isObj(raw)) {
    errors.push("roles must have coordinator, captain and worker");
    return null;
  }
  const [coordinator, captain, worker] = ROLE_KEYS.map((role) => parseSpec(raw[role], role, errors));
  return coordinator && captain && worker ? { coordinator, captain, worker } : null;
}

/** Checks a config file's parsed JSON. Lists every problem, not only the first. */
export function parseConfig(raw: unknown): ParseResult<BrigadeConfig> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["the config must be a JSON object"] };
  if (!isText(raw.owner)) errors.push("owner must be your name");
  const roles = parseRoles(raw.roles, errors);
  const repoRoots = parseRepoRoots(raw.repoRoots, errors);
  const list = Array.isArray(raw.projects) ? raw.projects : [];
  if (!Array.isArray(raw.projects)) errors.push("projects must be a list");
  const projects = list.flatMap((p: unknown, i) => parseProject(p, i, errors) ?? []);
  const names = projects.map((p) => p.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) errors.push(`project names must be unique: ${[...new Set(twice)].join(", ")}`);
  if (errors.length || !roles || !isText(raw.owner)) return { ok: false, errors };
  return { ok: true, value: { owner: raw.owner, roles, repoRoots, projects } };
}

/** The config in the shape of the file. Settings that are null are left out. */
export function serializeConfig(config: BrigadeConfig): Record<string, unknown> {
  return {
    owner: config.owner,
    roles: config.roles,
    ...(config.repoRoots ? { repoRoots: config.repoRoots } : {}),
    projects: config.projects.map((p) => ({
      name: p.name,
      repo: p.repo,
      baseBranch: p.baseBranch,
      ...(p.github ? { github: p.github } : {}),
    })),
  };
}

/** The changed config, checked by the same rules as the file. Throws, naming every problem, if it would break. */
export function checkedChange(
  config: BrigadeConfig,
  change: (config: BrigadeConfig) => BrigadeConfig,
): { config: BrigadeConfig; json: Record<string, unknown> } {
  const json = serializeConfig(change(config));
  const parsed = parseConfig(json);
  if (!parsed.ok) throw new BrigadeError(`That change would break the config:\n- ${parsed.errors.join("\n- ")}`);
  return { config: parsed.value, json };
}

/** The config with one more project. The name must follow the rules and be unused. */
export function withProject(config: BrigadeConfig, project: ProjectConfig): BrigadeConfig {
  if (!NAME.test(project.name))
    throw new BrigadeError(`"${project.name}" is not a valid project name: use 1-24 of a-z, 0-9 and -.`);
  if (config.projects.some((p) => p.name === project.name))
    throw new BrigadeError(`A project named "${project.name}" already exists.`);
  if (config.projects.some((p) => p.repo === project.repo)) {
    throw new BrigadeError(`${project.repo} is already a project. One project per repo.`);
  }
  return { ...config, projects: [...config.projects, project] };
}

/** The config with one project's base branch changed. Nothing else about a project changes this way. */
export function withBaseBranch(config: BrigadeConfig, name: string, baseBranch: string): BrigadeConfig {
  if (!config.projects.some((p) => p.name === name)) throw new BrigadeError(`No project "${name}".`);
  return { ...config, projects: config.projects.map((p) => (p.name === name ? { ...p, baseBranch } : p)) };
}
