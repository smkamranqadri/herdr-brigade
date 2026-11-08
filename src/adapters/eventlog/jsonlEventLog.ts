import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import type { EventLog } from "../../application/ports.ts";
import { errorCode } from "../../domain/errors.ts";
import type { BrigadeEvent } from "../../domain/events.ts";

const NEWLINE = 0x0a;

/** Called for a whole line that isn't valid JSON, so a damaged log is reported, not silently trusted. */
export type BadLineReporter = (lineNumber: number, line: string) => void;

const toStderr: BadLineReporter = (n, line) => {
  console.error(`[brigade] events.jsonl line ${n} is not valid JSON and was skipped: ${line.slice(0, 120)}`);
};

/**
 * The event log as one JSON line per event. Each agent's MCP server appends to the same file. Each append is one
 * small write to a file opened for appending, which the local file system keeps whole; a crash can still leave a
 * fragment at the end, so an append that finds one starts on a new line, and a read skips damaged lines.
 * With many writers, that check can catch another append half-written and add a blank line. Reads skip blank lines,
 * and the extra newline goes before this event's own line, so it never splits an event. 8 processes appending 2,400
 * events at once lost none (2026-11-09).
 */
export class JsonlEventLog implements EventLog {
  private readonly file: string;
  private readonly onBadLine: BadLineReporter;

  constructor(file: string, onBadLine: BadLineReporter = toStderr) {
    this.file = file;
    this.onBadLine = onBadLine;
  }

  async append(event: BrigadeEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const prefix = (await this.endsMidLine()) ? "\n" : "";
    await appendFile(this.file, prefix + JSON.stringify(event) + "\n", { mode: 0o600 });
  }

  async read(): Promise<BrigadeEvent[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if (errorCode(err) === "ENOENT") return [];
      throw err;
    }
    // The text after the last newline is a line still being written, or a fragment: not an event yet.
    const lines = text.split("\n").slice(0, -1);
    const events: BrigadeEvent[] = [];
    lines.forEach((line, i) => {
      if (line === "") return;
      try {
        events.push(JSON.parse(line) as BrigadeEvent);
      } catch {
        this.onBadLine(i + 1, line);
      }
    });
    return events;
  }

  private async endsMidLine(): Promise<boolean> {
    let handle;
    try {
      handle = await open(this.file, "r");
    } catch (err) {
      if (errorCode(err) === "ENOENT") return false;
      throw err;
    }
    try {
      const { size } = await handle.stat();
      if (size === 0) return false;
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      return last[0] !== NEWLINE;
    } finally {
      await handle.close();
    }
  }
}
