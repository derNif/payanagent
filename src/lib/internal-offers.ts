import { runUpstream } from "./labs-upstream";

// Internal handlers are PayanAgent-operated backends (e.g. PayanAgent Labs
// offers). When an offer carries an `internalHandler` id, the buy flow runs it
// server-side AFTER settlement instead of proxying to an external seller
// endpoint — so the backend's API key never leaves the server and can't be
// drained by unpaid callers (there is no public route to hit).
//
// Handler id format: "<group>:<tool>", e.g. "labs:search".
export async function runInternalHandler(
  handler: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [group, tool] = handler.split(":");
  if (group === "labs") return runUpstream(tool, input);
  throw new Error(`unknown internal handler: ${handler}`);
}
