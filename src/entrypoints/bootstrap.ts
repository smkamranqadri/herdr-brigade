// The composition root: the only place that builds concrete adapters (guide A2).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Deps } from "../application/ports.ts";
import { JsonlEventLog } from "../adapters/eventlog/jsonlEventLog.ts";
import { GitWorktrees } from "../adapters/git/gitWorktrees.ts";
import { HarnessAdapters } from "../adapters/harness/harnesses.ts";
import { HcTerminals, hcRunner } from "../adapters/hc/hcTerminals.ts";
import { FilePrompts } from "../adapters/prompts/filePrompts.ts";
import { randomIds, systemClock } from "../adapters/system/system.ts";
import { parseConfig, type BrigadeConfig } from "../domain/config.ts";
import { mcpEnv, type Paths } from "./settings.ts";

export class ConfigProblem extends Error {
  override readonly name = "ConfigProblem";
}

export async function loadConfig(file: string): Promise<BrigadeConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new ConfigProblem(
      missing ? `No config at ${file}. Run "brigade init" first.` : `Can't read ${file}: ${String(err)}`,
    );
  }
  const parsed = parseConfig(raw);
  if (!parsed.ok) throw new ConfigProblem(`${file} has problems:\n- ${parsed.errors.join("\n- ")}`);
  return parsed.value;
}

export function buildDeps(config: BrigadeConfig, paths: Paths): Deps {
  return {
    config,
    terminals: new HcTerminals({ run: hcRunner(paths.hc) }),
    harnesses: new HarnessAdapters(path.join(paths.stateDir, "agents")),
    events: new JsonlEventLog(path.join(paths.stateDir, "events.jsonl")),
    worktrees: new GitWorktrees(paths.worktreesRoot),
    prompts: new FilePrompts(paths.promptsDir),
    clock: systemClock,
    ids: randomIds,
    mcpFor: (context) => ({ command: paths.node, args: [paths.cli, "mcp"], env: mcpEnv(context, paths) }),
    coordinatorFolder: path.join(paths.stateDir, "coordinator"),
  };
}
