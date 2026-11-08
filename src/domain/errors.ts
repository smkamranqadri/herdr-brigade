/** A problem the calling agent can fix, such as an unknown project. The MCP edge shows its message as the tool's error. */
export class BrigadeError extends Error {
  override readonly name = "BrigadeError";
}
