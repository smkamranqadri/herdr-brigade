// Guide C11 and Q4: the count of suppressions and type escapes may fall, never rise.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, ".suppressions");
const SCANNED = ["src", "scripts"];
const PATTERNS: readonly RegExp[] = [
  /eslint-disable/g,
  /@ts-(ignore|expect-error|nocheck)/g,
  /\bas any\b/g,
  /:\s*any\b/g,
  /\bas unknown as\b/g,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && full !== fileURLToPath(import.meta.url) ? [full] : [];
  });
}

const count = SCANNED.flatMap((d) => files(path.join(ROOT, d)))
  .map((f) => readFileSync(f, "utf8"))
  .reduce((sum, text) => sum + PATTERNS.reduce((n, p) => n + (text.match(p)?.length ?? 0), 0), 0);
const baseline = Number(readFileSync(BASELINE_FILE, "utf8").trim());

console.log(`suppressions: ${count} (baseline ${baseline})`);
if (count > baseline) {
  console.error("The suppression count rose. Fix the code instead, or explain the new one and raise .suppressions.");
  process.exit(1);
}
