// Sub-cent-aware USD amount. Proxied receipts are often $0.001, which rounds to
// 0 cents — derive from amountMicroUsd (USDC base units / millionths) when set.
export function usdAmount(
  amountCents: number,
  amountMicroUsd?: number | null,
): string {
  const v = amountMicroUsd != null ? amountMicroUsd / 1e6 : amountCents / 100;
  if (!Number.isFinite(v)) return "$0.00";
  return v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
