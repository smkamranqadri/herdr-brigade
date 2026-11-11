#!/usr/bin/env node
// The `brigade` command: init, start, open, status, the panel, and mcp (the server each agent starts).
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { listTasks, openAgent, openBrigade } from "../application/coordinator.ts";
import { findTerminals } from "../application/launch.ts";
import { BrigadeError, errorCode } from "../domain/errors.ts";
import { installMod } from "../adapters/herdrApp/herdrApp.ts";
import { serve } from "../adapters/mcp/protocol.ts";
import { toolsFor } from "../adapters/mcp/tools.ts";
import { buildDeps, buildHerdrApp, buildWorkspace, freshDeps, loadConfig } from "./bootstrap.ts";
import { readAgentContext, readPaths, type Paths } from "./settings.ts";

const USAGE = `brigade init          write a starter config
brigade start         open the Brigade space in herdr-app: the Coordinator in tab 1 (started once, continuing
                      its last conversation) and a tab for each running Captain
brigade start --new   the same, with the Coordinator in a new conversation
brigade open <t>      open the Coordinator's or a Captain's tab (terminal address t)
brigade status        list the brigade's agents and tasks
brigade panel         open or close the Brigade panel as a window
brigade mod install   install the Brigade panel into herdr-app
brigade mcp           the MCP server each agent starts (not for people)`;

const STARTER = (owner: string) => ({
  owner,
  roles: {
    coordinator: { harness: "claude", model: "claude-opus-5-5", effort: "medium" },
    captain: { harness: "claude", model: "claude-sonnet-5-5", effort: "low" },
    worker: { harness: "claude", model: "claude-sonnet-5-5", effort: "medium", permissions: "auto" },
  },
  projects: [],
});

/** The owner's name for prompts: git's user.name, else the login name. */
function ownerName(): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["config", "user.name"], { timeout: 5_000, encoding: "utf8" }, (err, stdout) => {
      resolve(!err && stdout.trim() ? stdout.trim() : userInfo().username);
    });
  });
}

async function init(paths: Paths): Promise<string> {
  await mkdir(path.dirname(paths.configFile), { recursive: true });
  try {
    await writeFile(paths.configFile, JSON.stringify(STARTER(await ownerName()), null, 2) + "\n", { flag: "wx" });
  } catch (err) {
    if (errorCode(err) === "EEXIST") return `${paths.configFile} already exists; left as it is.`;
    throw err;
  }
  return `Wrote ${paths.configFile}. Add your projects to it, then run "brigade start".`;
}

async function start(paths: Paths): Promise<string> {
  const deps = buildDeps(await loadConfig(paths), paths);
  const workspace = buildWorkspace(paths);
  await mkdir(deps.coordinatorFolder, { recursive: true });
  const { address, started } = await openBrigade(deps, workspace, { fresh: process.argv[3] === "--new" });
  const verb = started ? "Started" : "Already running:";
  return `${verb} the Coordinator in terminal ${address}. It is in tab 1 of the Brigade space in herdr-app.`;
}

async function open(paths: Paths): Promise<string> {
  const address = process.argv[3];
  if (!address) throw new BrigadeError("Usage: brigade open <terminal address>");
  await openAgent(buildDeps(await loadConfig(paths), paths), buildWorkspace(paths), address);
  return `Opened ${address} in herdr-app.`;
}

async function panel(paths: Paths): Promise<string> {
  await buildHerdrApp(paths).openPanel();
  return "Toggled the Brigade panel window.";
}

async function modInstall(paths: Paths): Promise<string> {
  // The mod can't set environment variables, so the Start button runs env with them: it starts this same brigade.
  const start = [
    "env",
    `BRIGADE_CONFIG=${paths.configFile}`,
    `BRIGADE_STATE=${paths.stateDir}`,
    `BRIGADE_WORKTREES=${paths.worktreesRoot}`,
    paths.node,
    paths.cli,
    "start",
  ];
  const target = await installMod(paths.modSource, paths.herdrAppHome, {
    stateDir: paths.stateDir,
    configFile: paths.configFile,
    start,
  });
  const check = await buildHerdrApp(paths).check(target);
  return [
    `Installed the Brigade panel in ${target}.`,
    check,
    'Open it as a window with "brigade panel". A button beside Automations is optional: it needs the auto-tabs mod and two config edits (docs/herdr-app.md).',
  ].join("\n");
}

async function status(paths: Paths): Promise<string> {
  const deps = buildDeps(await loadConfig(paths), paths);
  const agents = await findTerminals(deps, {});
  const lines = agents.map((a) => `${a.address}  ${a.name}  ${a.status ?? ""}`);
  return [`Agents (${agents.length}):`, ...lines, "", "Tasks:", await listTasks(deps, null)].join("\n");
}

async function mcp(paths: Paths): Promise<void> {
  const deps = buildDeps(await loadConfig(paths), paths);
  const ctx = readAgentContext(process.env);
  // stdout carries the protocol, so problems go to stderr, which the harness keeps in its MCP log.
  await serve(toolsFor(deps, ctx, freshDeps(deps)), process.stdin, process.stdout, (err) => {
    console.error("[brigade mcp]", err);
  });
}

async function main(command: string | undefined): Promise<number> {
  const paths = readPaths(process.env);
  if (command === "mcp") {
    await mcp(paths);
    return 0;
  }
  if (command === "mod" && process.argv[3] === "install") {
    console.log(await modInstall(paths));
    return 0;
  }
  const run = { init, start, open, status, panel }[command ?? ""];
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
    console.error(err instanceof BrigadeError ? err.message : err);
    process.exitCode = 1;
  },
);
