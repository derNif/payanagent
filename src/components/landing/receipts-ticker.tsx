"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const VERB_LABELS: Record<string, string> = {
  direct: "buy",
  escrow_deposit: "escrow",
  escrow_release: "release",
  escrow_refund: "refund",
};

// Live row of recent real settlements, designed to sit as the header row of
// the hero stats block (same hairline-divided container). Renders nothing
// until the first receipt exists — no fake data, no aggregate totals.
export function ReceiptsTicker() {
  const receipts = useQuery(api.receipts.listFeed, { limit: 5 });

  if (!receipts || receipts.length === 0) return null;

  return (
    <div className="bg-black px-4 sm:px-6 py-3 flex items-center gap-x-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground/60 tracking-widest uppercase shrink-0">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
        Live
      </span>
      {receipts.map((r) => (
        <Link
          key={r._id}
          href={`/marketplace/receipts/${r._id}`}
          className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors whitespace-nowrap shrink-0"
        >
          <span className="text-primary">${(r.amountCents / 100).toFixed(2)}</span>{" "}
          {VERB_LABELS[r.settlementType] ?? r.settlementType} · {formatTime(r.emittedAt)}
        </Link>
      ))}
      <Link
        href="/marketplace/receipts"
        className="font-mono text-xs text-muted-foreground/60 hover:text-primary transition-colors whitespace-nowrap shrink-0 ml-auto"
      >
        all receipts →
      </Link>
    </div>
  );
}
