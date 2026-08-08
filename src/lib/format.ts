// All USD display goes through here. Proxied x402 offers/receipts are often
// sub-cent ($0.001), which a fixed 2-decimal format rounds to $0.00 — instead
// show the real value, up to 6 decimals (USDC precision), trailing zeros
// trimmed, never below 2 decimals.
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  );
}

// Sub-cent-aware USD amount from cents + optional exact micro-USD (USDC base
// units / millionths). Prefer the micro value when set — amountCents rounds
// sub-cent amounts to 0.
export function usdAmount(
  amountCents: number,
  amountMicroUsd?: number | null,
): string {
  return usd(amountMicroUsd != null ? amountMicroUsd / 1e6 : amountCents / 100);
}

// Offer price: external offers carry the exact price in amountRaw (USDC base
// units) while priceCents rounds sub-cent prices to 0.
export function offerPrice(o: {
  amountRaw?: string | null;
  priceCents: number;
}): string {
  const v = o.amountRaw ? Number(o.amountRaw) / 1e6 : o.priceCents / 100;
  if (!Number.isFinite(v) || v <= 0) return "free";
  return usd(v);
}
