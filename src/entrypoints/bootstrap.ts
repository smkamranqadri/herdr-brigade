// The composition root: the only place that builds concrete adapters (guide A2).
import path from "node:path";
import type { Deps } from "../application/ports.ts";
import { JsonlEventLog } from "../adapters/eventlog/jsonlEventLog.ts";
import { GitWorktrees } from "../adapters/git/gitWorktrees.ts";
import { HarnessAdapters } from "../adapters/harness/harnesses.ts";
import { HcTerminals, hcRunner } from "../adapters/hc/hcTerminals.ts";
import { FilePrompts } from "../adapters/prompts/filePrompts.ts";
import { randomIds, systemClock } from "../adapters/system/system.ts";
import type { BrigadeConfig } from "../domain/config.ts";
import { FileConfigStore } from "../adapters/config/fileConfigStore.ts";
import { GitRepos } from "../adapters/git/gitRepos.ts";
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
    defaultRepoRoots: paths.defaultRepoRoots,
    terminals: new HcTerminals({ run: hcRunner(paths.hc) }),
    harnesses: new HarnessAdapters({ agentsDir: path.join(paths.stateDir, "agents"), piExtension: paths.piExtension }),
    events: new JsonlEventLog(path.join(paths.stateDir, "events.jsonl")),
    worktrees: new GitWorktrees(paths.worktreesRoot),
    prompts: new FilePrompts(paths.promptsDir),
    clock: systemClock,
    ids: randomIds,
    mcpFor: (context) => ({ command: paths.node, args: [paths.cli, "mcp"], env: mcpEnv(context, paths) }),
    coordinatorFolder: path.join(paths.stateDir, "coordinator"),
  };
}

/** Deps with a config snapshot read now: each tool call gets its own, so a project added by one agent is seen by all. */
export function freshDeps(base: Deps): () => Promise<Deps> {
  return async () => ({ ...base, config: await base.configStore.read() });
}
