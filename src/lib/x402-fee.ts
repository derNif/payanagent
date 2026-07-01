import { NextRequest } from "next/server";
import { settlePayment, getNetworkId } from "@/lib/x402";

// ─────────────────────────────────────────────────────────────────────────────
// PayanAgent fee — the ONE place the platform fee lives, shared by every buy
// route (the universal /x402/:offerId, native + relayed) so all offers work
// the same and turning the fee on is a single switch.
//
// NON-CUSTODIAL by design: the fee is a SECOND, buyer-signed payment that goes
// straight to the platform wallet — we never sit between the buyer and the
// seller's money. A 402 advertises the fee in the `x-payanagent-fee` header; a
// PayanAgent-aware client signs it and returns it in `x-payanagent-fee-payment`;
// we settle that leg to our wallet. Standard x402 clients ignore the header and
// simply pay the underlying price (no fee) — by design, the fee is enforced on
// our own/exclusive supply and collected from buyers who use our checkout.
//
// OFF until PAYANAGENT_FEE_BPS > 0. At 0, every function below is a no-op and
// the buy routes behave byte-for-byte as before.
// ─────────────────────────────────────────────────────────────────────────────

export const FEE_BPS = Number(process.env.PAYANAGENT_FEE_BPS || "0");
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || "";

const ADVERT_HEADER = "x-payanagent-fee";
const PAYMENT_HEADER = "x-payanagent-fee-payment";

// USDC (6 decimals) per Base network id.
const USDC: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function feeEnabled(): boolean {
  return FEE_BPS > 0 && !!PLATFORM_WALLET;
}

export function feeMicroUsd(priceMicroUsd: number): number {
  if (!feeEnabled()) return 0;
  return Math.floor((priceMicroUsd * FEE_BPS) / 10_000);
}

// The value for the `x-payanagent-fee` advertisement header, or null when the
// fee is off (→ caller sets no header → unchanged behavior).
export function feeAdvertHeader(priceMicroUsd: number): string | null {
  const fee = feeMicroUsd(priceMicroUsd);
  if (fee <= 0) return null;
  const network = getNetworkId();
  return JSON.stringify({
    payTo: PLATFORM_WALLET,
    amount: String(fee), // USDC base units
    asset: USDC[network] ?? null,
    network,
    bps: FEE_BPS,
    note: "Optional PayanAgent routing fee — sign and return in x-payanagent-fee-payment.",
  });
}

// Attach the fee advertisement to a 402 response (no-op when the fee is off).
export function attachFeeAdvert(headers: Headers, priceMicroUsd: number): void {
  const v = feeAdvertHeader(priceMicroUsd);
  if (v) headers.set(ADVERT_HEADER, v);
}

// Settle the buyer's fee leg to the platform wallet, if they sent one. Returns
// the fee tx hash (or null). Non-custodial: this is a buyer→platform payment we
// only collect; the underlying buyer→seller payment is untouched. No-op when the
// fee is off or no fee payment was provided.
export async function collectFee(request: NextRequest): Promise<string | null> {
  if (!feeEnabled()) return null;
  const feePayment = request.headers.get(PAYMENT_HEADER);
  if (!feePayment) return null;
  try {
    // settlePayment derives the requirements from the signed payload itself.
    const r = await settlePayment(feePayment, "");
    return r.success ? r.txHash ?? "" : null;
  } catch {
    return null;
  }
}
