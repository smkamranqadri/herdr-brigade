// Guide C11 and Q4: the count of suppressions and type escapes may fall, never rise.
// It counts inline marks, casts, any-like types and the exemptions in the tool configs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, ".suppressions");
const SCANNED = ["src", "scripts"];
const SELF = fileURLToPath(import.meta.url);

/** Escapes in TypeScript code. */
const CODE_PATTERNS: Readonly<Record<string, RegExp>> = {
  "inline eslint-disable": /eslint-disable/g,
  "@ts- comments": /@ts-(ignore|expect-error|nocheck)/g,
  "any types": /(:\s*any\b|\bas any\b|<any>)/g,
  "casts (not as const)": /\bas (?!const\b|any\b)(?:readonly |unknown\b|[A-Z{[(])/g,
};

/** Exemptions in the tool configs: rules turned off, type checks disabled, files left out of a rule. */
const CONFIG_PATTERNS: Readonly<Record<string, RegExp>> = {
  "eslint.config.js": /"off"|disableTypeChecked/g,
  "tsconfig.json": /"skipLibCheck":\s*true/g,
  ".dependency-cruiser.cjs": /pathNot: "\\\\\.test/g,
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && full !== SELF ? [full] : [];
  });
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

const code = SCANNED.flatMap((d) => files(path.join(ROOT, d))).map((f) => readFileSync(f, "utf8"));
const rows: [string, number][] = [
  ...Object.entries(CODE_PATTERNS).map(([name, p]): [string, number] => [
    name,
    code.reduce((n, t) => n + count(t, p), 0),
  ]),
  ...Object.entries(CONFIG_PATTERNS).map(([file, p]): [string, number] => [
    file,
    count(readFileSync(path.join(ROOT, file), "utf8"), p),
  ]),
];
const total = rows.reduce((n, [, c]) => n + c, 0);
const baseline = Number(readFileSync(BASELINE_FILE, "utf8").trim());

console.log(`suppressions: ${total} (baseline ${baseline}): ${rows.map(([name, c]) => `${name} ${c}`).join(", ")}`);
if (total > baseline) {
  console.error("The suppression count rose. Fix the code instead, or explain the new one and raise .suppressions.");
  process.exit(1);
}
