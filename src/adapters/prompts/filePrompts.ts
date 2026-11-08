import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prompts } from "../../application/ports.ts";
import type { Role } from "../../domain/agent.ts";

/** Reads `<dir>/<role>.md` and fills its `{{NAME}}` placeholders. A placeholder with no value is an error. */
export class FilePrompts implements Prompts {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async render(role: Role, values: Readonly<Record<string, string>>): Promise<string> {
    const template = await readFile(path.join(this.dir, `${role}.md`), "utf8");
    return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`prompts/${role}.md uses {{${key}}}, which has no value`);
      return value;
    });
  }
}
