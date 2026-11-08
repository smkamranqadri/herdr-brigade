// Starts the POC Captain: node poc/launch.mjs --repo <git folder> --project <name> "<first message>"
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { agentArgv, BRIGADE_LABEL, EVENTS_FILE, recordEvent, STATE_DIR } from "./agents.mjs";
import { answerTrustPrompt, launch } from "./hc.mjs";

const { values, positionals } = parseArgs({
  options: { repo: { type: "string" }, project: { type: "string", default: "demo" } },
  allowPositionals: true,
});
const repo = values.repo && path.resolve(values.repo);
const message = positionals.join(" ").trim();
if (!repo || !fs.existsSync(path.join(repo, ".git")) || !message) {
  console.error('usage: node poc/launch.mjs --repo <git folder> [--project name] "<first message>"');
  process.exit(2);
}

const hcPath = execFileSync("sh", ["-c", "command -v hc"], { encoding: "utf8" }).trim();
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.rmSync(EVENTS_FILE, { force: true });

const argv = agentArgv({
  role: "captain",
  id: "captain",
  values: { PROJECT: values.project },
  env: { BRIGADE_PROJECT: values.project, BRIGADE_REPO: repo, BRIGADE_HC: hcPath },
  firstMessage: message,
});
// The Captain's parent is whoever runs this script; --no-notify keeps hc's notes out of that terminal.
const address = launch({
  name: "brigade-captain",
  cwd: repo,
  labels: { brigade: BRIGADE_LABEL, project: values.project, task: "captain", role: "captain", title: "Captain" },
  notify: false,
  argv,
});
const trusted = answerTrustPrompt(address);
recordEvent({ role: "launcher", project: values.project, kind: "captain_started", data: { address, trustPromptAnswered: trusted } });
console.log(JSON.stringify({ captain: address, trustPromptAnswered: trusted }));
