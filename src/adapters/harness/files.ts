import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where one agent's launch files go, and the shared files a harness may need. */
export interface HarnessFiles {
  readonly agentDir: string;
  /** The pi extension that registers brigade's MCP server. */
  readonly piExtension: string;
}

/** Writes a private file in the agent's folder and returns its path. */
export async function writeAgentFile(agentDir: string, name: string, content: string): Promise<string> {
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const file = path.join(agentDir, name);
  await writeFile(file, content, { mode: 0o600 });
  return file;
}
