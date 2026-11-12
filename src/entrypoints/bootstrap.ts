// The composition root: the only place that builds concrete adapters (guide A2).
import path from "node:path";
import type { Deps, Workspace } from "../application/ports.ts";
import { JsonlEventLog } from "../adapters/eventlog/jsonlEventLog.ts";
import { GitWorktrees } from "../adapters/git/gitWorktrees.ts";
import { HarnessAdapters } from "../adapters/harness/harnesses.ts";
import { HcTerminals, hcRunner } from "../adapters/hc/hcTerminals.ts";
import { FilePrompts } from "../adapters/prompts/filePrompts.ts";
import { FileLocks } from "../adapters/system/fileLocks.ts";
import { localFolders, randomIds, systemClock } from "../adapters/system/system.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import { FileConfigStore } from "../adapters/config/fileConfigStore.ts";
import { GitRepos } from "../adapters/git/gitRepos.ts";
import { GhCli, ghRunner } from "../adapters/github/ghCli.ts";
import { HerdrApp, HerdrAppWorkspace, herdrAppRunner } from "../adapters/herdrApp/herdrApp.ts";
import { BrigadeError } from "../domain/errors.ts";
import { mcpEnv, type Paths } from "./settings.ts";

/** The config as the CLI loads it at start. Tool calls read their own fresh snapshot (see freshDeps). */
export function loadConfig(paths: Paths): Promise<BrigadeConfig> {
  return new FileConfigStore(paths.configFile).read();
}

export function buildDeps(config: BrigadeConfig, paths: Paths): Deps {
  return {
    config,
    configStore: new FileConfigStore(paths.configFile),
    repos: new GitRepos(),
    github: new GhCli(ghRunner()),
    defaultRepoRoots: paths.defaultRepoRoots,
    terminals: new HcTerminals({ run: hcRunner(paths.hc) }),
    harnesses: new HarnessAdapters({ agentsDir: path.join(paths.stateDir, "agents"), piExtension: paths.piExtension }),
    events: new JsonlEventLog(path.join(paths.stateDir, "events.jsonl")),
    worktrees: new GitWorktrees(paths.worktreesRoot),
    prompts: new FilePrompts(paths.promptsDir),
    clock: systemClock,
    ids: randomIds,
    mcpFor: (context) => ({ command: paths.node, args: [paths.cli, "mcp"], env: mcpEnv(context, paths) }),
    folders: localFolders,
    coordinatorFolder: coordinatorFolder(paths),
    captainsFolder: path.join(paths.stateDir, "captains"),
    workspace: buildWorkspace(paths),
    locks: new FileLocks(path.join(paths.stateDir, "locks")),
  };
}

function coordinatorFolder(paths: Paths): string {
  return path.join(paths.stateDir, "coordinator");
}

function herdrAppBin(paths: Paths): string {
  if (!paths.herdrApp) throw new BrigadeError("herdr-app is not on PATH. Install Herdr's window first.");
  return paths.herdrApp;
}

/** herdr-app for the panel and the mod. */
export function buildHerdrApp(paths: Paths): HerdrApp {
  return new HerdrApp(herdrAppRunner(herdrAppBin(paths)));
}

/**
 * Where brigade opens agents: herdr-app. It is built on first use, so a missing herdr-app fails only the call that
 * needs it, and the MCP server's other tools still work.
 */
function buildWorkspace(paths: Paths): Workspace {
  let built: Workspace | null = null;
  const workspace = (): Workspace => (built ??= new HerdrAppWorkspace(herdrAppRunner(herdrAppBin(paths))));
  return {
    check: () => workspace().check(),
    open: (address, options) => workspace().open(address, options),
  };
}

/** Deps with a config snapshot read now: each tool call gets its own, so a project added by one agent is seen by all. */
export function freshDeps(base: Deps): () => Promise<Deps> {
  return async () => ({ ...base, config: await base.configStore.read() });
}
