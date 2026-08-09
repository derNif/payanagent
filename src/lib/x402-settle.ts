// The x402 "money moves here" sequence, shared by every paid route
// (/x402/:id, /offers/:id/buy, /requests/:id/approve, escrow on request
// creation): integrity check -> facilitator verify -> facilitator settle, each
// failure answered with the same 402 body.
import { NextResponse } from "next/server";
import { jsonError } from "./api-http";
import { settlePayment, verifyPayment, verifyPaymentIntegrity } from "./x402";

/** x402 clients send the signed payment under either header. */
export function getPaymentSignature(request: Request): string | null {
  return (
    request.headers.get("payment-signature") || request.headers.get("x-payment")
  );
}

export type SettleOutcome =
  | { ok: true; txHash: string }
  | { ok: false; response: NextResponse };

/**
 * Verify and settle a signed payment.
 *
 * `onFailure` runs before any failure response is returned — used by the
 * request-approve path to release the settlement lock it holds.
 */
export async function settleSignedPayment({
  request,
  paymentSignature,
  amountCents,
  payTo,
  onFailure,
}: {
  request: Request;
  paymentSignature: string;
  amountCents: number;
  /** Expected recipient; defaults to the platform wallet (escrow flows). */
  payTo?: string;
  onFailure?: () => Promise<unknown>;
}): Promise<SettleOutcome> {
  const fail = async (message: string): Promise<SettleOutcome> => {
    if (onFailure) await onFailure();
    return { ok: false, response: jsonError(message, 402) };
  };

  const integrity = verifyPaymentIntegrity(paymentSignature, amountCents, payTo);
  if (!integrity.valid) {
    return fail(`Payment integrity check failed: ${integrity.error}`);
  }

  const paymentRequired = request.headers.get("payment-required") || "";

  const verification = await verifyPayment(paymentSignature, paymentRequired);
  if (!verification.valid) {
    return fail(`Payment verification failed: ${verification.error}`);
  }

  const settlement = await settlePayment(paymentSignature, paymentRequired);
  if (!settlement.success) {
    return fail(`Payment settlement failed: ${settlement.error}`);
  }

  return { ok: true, txHash: settlement.txHash || "" };
}
