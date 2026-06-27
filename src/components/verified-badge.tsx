import { BadgeCheck } from "lucide-react";

// A verified-seller seal — the receipt-derived "trusted" signal as a real icon
// (lucide BadgeCheck), shown when a seller clears the trust gate (3+ distinct
// buyers, >=90% delivered, 5+ sales). `title` surfaces the why on hover.
export function VerifiedBadge({
  size = 16,
  className = "",
  title = "Verified seller — 90%+ delivered across 3+ distinct buyers, settled on-chain",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <BadgeCheck
      size={size}
      aria-label="Verified seller"
      className={`inline-block shrink-0 text-primary ${className}`}
    >
      <title>{title}</title>
    </BadgeCheck>
  );
}
