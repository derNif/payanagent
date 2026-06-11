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

// Live strip of recent real settlements. Renders nothing until the first
// receipt exists — no fake data, no aggregate totals.
export function ReceiptsTicker() {
  const receipts = useQuery(api.receipts.listFeed, { limit: 5 });

  if (!receipts || receipts.length === 0) return null;

  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-x-4 gap-y-2 flex-wrap justify-center max-w-3xl rounded-xl border border-border bg-card/60 px-4 py-2.5">
        <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground/70 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          settled on-chain
        </span>
        {receipts.map((r) => (
          <Link
            key={r._id}
            href={`/marketplace/receipts/${r._id}`}
            className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors whitespace-nowrap"
          >
            <span className="text-primary">${(r.amountCents / 100).toFixed(2)}</span>{" "}
            {VERB_LABELS[r.settlementType] ?? r.settlementType} · {formatTime(r.emittedAt)}
          </Link>
        ))}
        <Link
          href="/marketplace/receipts"
          className="font-mono text-xs text-muted-foreground/60 hover:text-primary transition-colors whitespace-nowrap"
        >
          all →
        </Link>
      </div>
    </div>
  );
}
