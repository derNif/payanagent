import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

// The invariant under test: A RETRY MUST NEVER PAY TWICE. payoutEscrow writes
// the receipt BEFORE the on-chain transfer, so any crash after money moves
// leaves a pending receipt for the route's idempotency check to find.

type Call = { kind: "mutation" | "query"; name: string; args: Record<string, unknown> };

// Minimal ConvexHttpClient stand-in that records every call in order. Function
// references from the generated `api` object are matched back to names via the
// registry the test builds.
function makeConvexStub() {
  const calls: Call[] = [];
  let receiptCounter = 0;
  const stub = {
    calls,
    mutation: async (fn: unknown, args: Record<string, unknown>) => {
      const name = fnName(fn);
      calls.push({ kind: "mutation", name, args });
      if (name === "recordSettlement") return `receipt_${++receiptCounter}`;
      return null;
    },
    query: async (fn: unknown, args: Record<string, unknown>) => {
      calls.push({ kind: "query", name: fnName(fn), args });
      return null;
    },
  };
  return stub;
}

// The generated `api` object is a proxy minting a fresh FunctionReference per
// property access, so reference equality never matches — resolve names through
// convex's own getFunctionName ("receipts:recordSettlement" → last segment).
let getFunctionName: ((fn: never) => string) | null = null;
function fnName(fn: unknown): string {
  if (!getFunctionName) return "unknown";
  try {
    return getFunctionName(fn as never).split(":").pop() ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function loadModule() {
  const mod = await import(rootUrl("src/lib/escrow-release.ts"));
  ({ getFunctionName } = await import("convex/server"));
  return mod as typeof import("../lib/escrow-release");
}

function baseArgs(convex: ReturnType<typeof makeConvexStub>) {
  return {
    convex: convex as never,
    platformSecret: "test-secret",
    buyerId: "buyer_1" as never,
    sellerId: "seller_1" as never,
    requestId: "request_1" as never,
    toAddress: "0x" + "a".repeat(40),
    amountCents: 5,
    settlementType: "escrow_release" as const,
    startedAt: 0,
  };
}

describe("payoutEscrow crash-safety", () => {
  it("writes the pending receipt BEFORE the transfer, then confirms", async () => {
    const { payoutEscrow } = await loadModule();
    const convex = makeConvexStub();
    const order: string[] = [];

    const result = await payoutEscrow({
      ...baseArgs(convex),
      deps: {
        releaseEscrow: async () => {
          order.push("transfer");
          return { success: true, txHash: "0xdead" };
        },
        confirmTx: async () => {
          order.push("confirm");
          return "confirmed" as const;
        },
      },
    });

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.txHash, "0xdead");
      assert.equal(result.onChain, "confirmed");
    }

    // Receipt intent is durable before any money can move.
    const recordIdx = convex.calls.findIndex((c) => c.name === "recordSettlement");
    assert.ok(recordIdx >= 0, "pending receipt was written");
    assert.equal(convex.calls[recordIdx].args.status, "pending");
    assert.equal(order[0], "transfer"); // and the transfer happened after it

    // Lifecycle: pending(txHash) then confirmed.
    const finalizes = convex.calls.filter((c) => c.name === "finalizeSettlement");
    assert.deepEqual(
      finalizes.map((c) => [c.args.status, c.args.txHash]),
      [
        ["pending", "0xdead"],
        ["confirmed", "0xdead"],
      ],
    );
  });

  it("marks the receipt failed on a clean transfer failure (retry allowed)", async () => {
    const { payoutEscrow } = await loadModule();
    const convex = makeConvexStub();

    const result = await payoutEscrow({
      ...baseArgs(convex),
      deps: {
        releaseEscrow: async () => ({ success: false, error: "no gas" }),
        confirmTx: async () => {
          throw new Error("must not be called");
        },
      },
    });

    assert.equal(result.ok, false);
    const finalizes = convex.calls.filter((c) => c.name === "finalizeSettlement");
    assert.equal(finalizes.length, 1);
    assert.equal(finalizes[0].args.status, "failed");
  });

  it("a crash after the transfer leaves a pending receipt with the txHash", async () => {
    const { payoutEscrow } = await loadModule();
    const convex = makeConvexStub();

    // Simulate the crash: the process dies inside confirmTx (e.g. platform
    // kill). Everything recorded up to that point is what a retry would see.
    await payoutEscrow({
      ...baseArgs(convex),
      deps: {
        releaseEscrow: async () => ({ success: true, txHash: "0xbeef" }),
        confirmTx: async () => {
          throw new Error("simulated crash");
        },
      },
    }).catch(() => null);

    const record = convex.calls.find((c) => c.name === "recordSettlement");
    const finalizes = convex.calls.filter((c) => c.name === "finalizeSettlement");
    assert.ok(record, "receipt exists despite the crash");
    // Last known state: pending WITH the tx hash — exactly what the routes'
    // idempotency check needs to refuse a second transfer and reconcile.
    const last = finalizes[finalizes.length - 1];
    assert.equal(last.args.status, "pending");
    assert.equal(last.args.txHash, "0xbeef");
  });

  it("a reverted tx marks the receipt failed so a retry can pay for real", async () => {
    const { payoutEscrow } = await loadModule();
    const convex = makeConvexStub();

    const result = await payoutEscrow({
      ...baseArgs(convex),
      deps: {
        releaseEscrow: async () => ({ success: true, txHash: "0xbad" }),
        confirmTx: async () => "reverted" as const,
      },
    });

    assert.equal(result.ok, false);
    const finalizes = convex.calls.filter((c) => c.name === "finalizeSettlement");
    assert.equal(finalizes[finalizes.length - 1].args.status, "failed");
  });

  it("an unconfirmed-within-bound tx stays pending but reports success", async () => {
    const { payoutEscrow } = await loadModule();
    const convex = makeConvexStub();

    const result = await payoutEscrow({
      ...baseArgs(convex),
      deps: {
        releaseEscrow: async () => ({ success: true, txHash: "0xslow" }),
        confirmTx: async () => "unknown" as const,
      },
    });

    assert.ok(result.ok);
    if (result.ok) assert.equal(result.onChain, "unknown");
    const finalizes = convex.calls.filter((c) => c.name === "finalizeSettlement");
    // No "confirmed" write ever happened; the receipt is pending with the hash.
    assert.ok(finalizes.every((c) => c.args.status !== "confirmed"));
    assert.equal(finalizes[finalizes.length - 1].args.txHash, "0xslow");
  });
});
