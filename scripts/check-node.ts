// Guide S2: the gate runs on the pinned Node version only. Prints it, and fails on any other.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  engines: { node: string };
};
const wanted = pkg.engines.node;
const running = process.versions.node;

console.log(`node ${running} (pinned ${wanted})`);
if (running !== wanted) {
  console.error(`Wrong Node version: run "mise install" in this folder, then try again.`);
  process.exit(1);
}
