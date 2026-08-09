// Post-settlement delivery for native offers, shared by the two buy routes:
// wallet-native /x402/:id and API-key /api/v1/offers/:id/buy. Money has already
// moved by the time this runs, so every exit marks the receipt delivered or not
// — the receipt must stay honest about what the buyer actually got.
import { NextResponse } from "next/server";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage, jsonError } from "./api-http";
import { runInternalHandler } from "./internal-offers";
import { assertPublicHttpUrl } from "./ssrf";
import { validateInput } from "./validate-input";

export interface DeliverableOffer {
  offerType: string;
  inputSchema?: string;
  internalHandler?: string;
  fileUrl?: string;
  endpoint?: string;
  httpMethod?: string;
}

/**
 * Read and validate the buyer's JSON body BEFORE settling — bad input must
 * never turn into a pay-then-fail. The raw body is returned so delivery can
 * forward the exact bytes without re-reading the stream.
 */
export async function readOfferInput(
  request: Request,
  inputSchema: string | undefined,
): Promise<
  | { rawBody: string; input: Record<string, unknown>; error?: never }
  | { rawBody?: never; input?: never; error: NextResponse }
> {
  const rawBody = await request.text().catch(() => "");
  let input: Record<string, unknown> = {};
  if (rawBody) {
    try {
      input = JSON.parse(rawBody);
    } catch {
      return { error: jsonError("Request body must be valid JSON", 400) };
    }
  }
  const check = validateInput(inputSchema, input);
  if (!check.valid) {
    return { error: jsonError(`Invalid input: ${check.error}`, 400) };
  }
  return { rawBody, input };
}

/**
 * Fulfil a paid offer: run the internal handler, hand back the file URL, or
 * proxy the seller's endpoint — recording delivery on the receipt either way.
 */
export async function deliverOffer({
  convex,
  platformSecret,
  offer,
  input,
  rawBody,
  receiptId,
  txHash,
}: {
  convex: ConvexHttpClient;
  platformSecret: string;
  offer: DeliverableOffer;
  input: Record<string, unknown>;
  rawBody: string;
  receiptId: Id<"receipts">;
  txHash: string;
}): Promise<NextResponse> {
  const mark = (delivered: boolean, deliveryStatus?: string) =>
    convex.mutation(api.receipts.markDelivered, {
      platformSecret,
      receiptId,
      delivered,
      deliveryStatus,
    });

  const deliveryHeaders = {
    "X-Receipt-Id": String(receiptId),
    "X-Tx-Hash": txHash,
  };

  // PayanAgent-operated (internal) offer: run the handler server-side. The
  // backend key lives only on the server and is never exposed as a callable
  // route, so it can't be drained by unpaid callers.
  if (offer.internalHandler) {
    try {
      const result = await runInternalHandler(offer.internalHandler, input);
      await mark(true);
      return NextResponse.json(result, { headers: deliveryHeaders });
    } catch (err) {
      const message = errorMessage(err, "service call failed");
      await mark(false, message.slice(0, 200));
      return jsonError(message, 502, {
        receiptId,
        message: "Payment settled but the service call failed.",
      });
    }
  }

  if (offer.offerType === "download") {
    await mark(true);
    return NextResponse.json({ receiptId, fileUrl: offer.fileUrl, txHash });
  }

  // Api-type offer: proxy to the seller's endpoint.
  if (!offer.endpoint) {
    await mark(false, "no endpoint configured");
    return jsonError("Offer has no endpoint configured", 500, { receiptId });
  }

  // SSRF guard: re-validate the endpoint right before fetching so a host that
  // now resolves to a private/metadata address is rejected (defends against
  // DNS rebinding even though we also validate at offer create/update time).
  try {
    await assertPublicHttpUrl(offer.endpoint);
  } catch (err) {
    await mark(false, "blocked endpoint");
    return jsonError(
      `Offer endpoint not allowed: ${errorMessage(err, "blocked endpoint")}`,
      502,
      { receiptId },
    );
  }

  try {
    // Never forward internal secrets to seller endpoints — they are arbitrary
    // external servers. Don't follow redirects into internal targets.
    const proxyResponse = await fetch(offer.endpoint, {
      method: offer.httpMethod || "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody || undefined,
      redirect: "manual",
    });
    const responseData = await proxyResponse.text();
    await mark(proxyResponse.ok, `HTTP ${proxyResponse.status}`);
    return new NextResponse(responseData, {
      status: proxyResponse.status,
      headers: {
        "Content-Type":
          proxyResponse.headers.get("Content-Type") || "application/json",
        ...deliveryHeaders,
      },
    });
  } catch {
    await mark(false, "endpoint unreachable");
    return jsonError("Failed to reach offer endpoint", 502, {
      receiptId,
      message: "Payment settled but the offer call failed.",
    });
  }
}
