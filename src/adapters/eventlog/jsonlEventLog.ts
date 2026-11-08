import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EventLog } from "../../application/ports.ts";
import type { BrigadeEvent } from "../../domain/events.ts";

/** The event log as one JSON line per event. Each agent's MCP server appends to the same file. */
export class JsonlEventLog implements EventLog {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async append(event: BrigadeEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, JSON.stringify(event) + "\n", { mode: 0o600 });
  }

  async read(): Promise<BrigadeEvent[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    // Only whole lines count: a last line without its newline is still being written.
    const complete = text.slice(0, text.lastIndexOf("\n") + 1);
    return complete
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as BrigadeEvent);
  }
}
