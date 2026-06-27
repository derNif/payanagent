// A verified-seller seal — the receipt-derived "trusted" signal as an icon
// (scalloped badge + check), not text. Shown when a seller clears the trust gate
// (3+ distinct buyers, >=90% delivered, 5+ sales). `title` surfaces the why on hover.
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Verified seller"
      className={`inline-block shrink-0 text-primary ${className}`}
    >
      <title>{title}</title>
      <path
        d="M12 1.5l2.39 1.74 2.95-.02 1.0 2.78 2.4 1.71-.92 2.8.92 2.8-2.4 1.71-1.0 2.78-2.95-.02L12 22.5l-2.39-1.74-2.95.02-1.0-2.78-2.4-1.71.92-2.8-.92-2.8 2.4-1.71 1.0-2.78 2.95.02L12 1.5z"
        fill="currentColor"
      />
      <path
        d="M8.2 12.1l2.6 2.6 5-5.2"
        stroke="#000"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
