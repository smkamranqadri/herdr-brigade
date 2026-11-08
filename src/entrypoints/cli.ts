#!/usr/bin/env node
// The `brigade` command: init, start, status, and mcp (the server each agent starts).
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { listTasks, startCoordinator } from "../application/coordinator.ts";
import { findTerminals } from "../application/launch.ts";
import { BrigadeError, errorCode } from "../domain/errors.ts";
import { HerdrApp, herdrAppRunner, installMod } from "../adapters/herdrApp/herdrApp.ts";
import { serve } from "../adapters/mcp/protocol.ts";
import { toolsFor } from "../adapters/mcp/tools.ts";
import { buildDeps, freshDeps, loadConfig } from "./bootstrap.ts";
import { readAgentContext, readPaths, type Paths } from "./settings.ts";

const USAGE = `brigade init          write a starter config
brigade start         start the Coordinator (once) and open it in herdr-app
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

function herdrApp(paths: Paths): HerdrApp {
  if (!paths.herdrApp) throw new BrigadeError("herdr-app is not on PATH. Install Herdr's window first.");
  return new HerdrApp(herdrAppRunner(paths.herdrApp));
}

async function start(paths: Paths): Promise<string> {
  const deps = buildDeps(await loadConfig(paths), paths);
  await mkdir(deps.coordinatorFolder, { recursive: true });
  const { address, started } = await startCoordinator(deps);
  const verb = started ? "Started" : "Already running:";
  const where = `${verb} the Coordinator in terminal ${address}.`;
  if (!paths.herdrApp) return `${where} Open it with: hc attach ${address}`;
  try {
    await herdrApp(paths).focus(address);
    return `${where} It is open in herdr-app: type to it there.`;
  } catch (err) {
    return `${where} Couldn't open it in herdr-app (${err instanceof Error ? err.message : String(err)}). Click it in the Agents sidebar, or run: hc attach ${address}`;
  }
}

async function panel(paths: Paths): Promise<string> {
  await herdrApp(paths).openPanel();
  return "Toggled the Brigade panel window.";
}

async function modInstall(paths: Paths): Promise<string> {
  const target = await installMod(paths.modSource, paths.herdrAppHome, paths.stateDir);
  const check = await herdrApp(paths).check(target);
  return `Installed the Brigade panel in ${target}.\n${check}`;
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
  const run = { init, start, status, panel }[command ?? ""];
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
