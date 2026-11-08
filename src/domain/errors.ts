/** A problem the calling agent can fix, such as an unknown project. The MCP edge shows its message as the tool's error. */
export class BrigadeError extends Error {
  override readonly name = "BrigadeError";
}

/** The `code` of a Node system error (such as "ENOENT"), or undefined for any other value. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  return typeof err.code === "string" ? err.code : undefined;
}
