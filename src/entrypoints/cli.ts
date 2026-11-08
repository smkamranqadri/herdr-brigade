#!/usr/bin/env node
// The `brigade` command: init, start, status, and mcp (the server each agent starts).
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { listTasks, startCoordinator } from "../application/coordinator.ts";
import { findTerminals } from "../application/launch.ts";
import { serve } from "../adapters/mcp/protocol.ts";
import { toolsFor } from "../adapters/mcp/tools.ts";
import { buildDeps, ConfigProblem, loadConfig } from "./bootstrap.ts";
import { readAgentContext, readPaths, type Paths } from "./settings.ts";

const USAGE = `brigade init     write a starter config
brigade start    start the Coordinator (once)
brigade status   list the brigade's agents and tasks
brigade mcp      the MCP server each agent starts (not for people)`;

const STARTER = (owner: string) => ({
  owner,
  roles: {
    coordinator: { harness: "claude", model: "claude-opus-5-5", effort: "medium" },
    captain: { harness: "claude", model: "claude-sonnet-5-5", effort: "low" },
    worker: { harness: "claude", model: "claude-sonnet-5-5", effort: "medium", permissions: "auto" },
  },
  projects: [],
});

async function init(paths: Paths): Promise<string> {
  await mkdir(path.dirname(paths.configFile), { recursive: true });
  try {
    await writeFile(paths.configFile, JSON.stringify(STARTER(userInfo().username), null, 2) + "\n", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return `${paths.configFile} already exists; left as it is.`;
    throw err;
  }
  return `Wrote ${paths.configFile}. Add your projects to it, then run "brigade start".`;
}

async function start(paths: Paths): Promise<string> {
  const deps = buildDeps(await loadConfig(paths.configFile), paths);
  await mkdir(deps.coordinatorFolder, { recursive: true });
  const { address, started } = await startCoordinator(deps);
  const verb = started ? "Started" : "Already running:";
  return `${verb} the Coordinator in terminal ${address}. Open it from Herdr's agent list, or run: hc attach ${address}`;
}

async function status(paths: Paths): Promise<string> {
  const deps = buildDeps(await loadConfig(paths.configFile), paths);
  const agents = await findTerminals(deps, {});
  const lines = agents.map((a) => `${a.address}  ${a.name}  ${a.status ?? ""}`);
  return [`Agents (${agents.length}):`, ...lines, "", "Tasks:", await listTasks(deps, null)].join("\n");
}

async function mcp(paths: Paths): Promise<void> {
  const deps = buildDeps(await loadConfig(paths.configFile), paths);
  const ctx = readAgentContext(process.env);
  // stdout carries the protocol, so problems go to stderr, which the harness keeps in its MCP log.
  await serve(toolsFor(deps, ctx), process.stdin, process.stdout, (err) => {
    console.error("[brigade mcp]", err);
  });
}

async function main(command: string | undefined): Promise<number> {
  const paths = readPaths(process.env);
  if (command === "mcp") {
    await mcp(paths);
    return 0;
  }
  const run = { init, start, status }[command ?? ""];
  if (!run) {
    console.log(USAGE);
    return command ? 2 : 0;
  }
  console.log(await run(paths));
  return 0;
}

main(process.argv[2]).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof ConfigProblem ? err.message : err);
    process.exitCode = 1;
  },
);
