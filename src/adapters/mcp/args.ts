// Argument checks at the MCP border (guide C7), shared by every tool table.
import { BrigadeError } from "../../domain/errors.ts";

export type Args = Readonly<Record<string, unknown>>;

const MAX_TEXT = 20_000;

/** Validates one string argument at the border (guide C7). */
export function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") throw new BrigadeError(`"${key}" is required and must be text.`);
  if (v.length > MAX_TEXT) throw new BrigadeError(`"${key}" is longer than ${MAX_TEXT} characters.`);
  return v;
}

export function optStr(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : str(args, key);
}

export const schema = (required: readonly string[], props: Readonly<Record<string, string>>) => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])),
  required,
});
