import { runLlmlayer } from "./llmlayer";

// Internal handlers are PayanAgent-operated backends (e.g. PayanAgent Labs
// offers). When an offer carries an `internalHandler` id, the buy flow runs it
// server-side AFTER settlement instead of proxying to an external seller
// endpoint — so the backend's API key never leaves the server and can't be
// drained by unpaid callers (there is no public route to hit).
//
// Handler id format: "<vendor>:<tool>", e.g. "llmlayer:search".
export async function runInternalHandler(
  handler: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [vendor, tool] = handler.split(":");
  if (vendor === "llmlayer") return runLlmlayer(tool, input);
  throw new Error(`unknown internal handler: ${handler}`);
}
