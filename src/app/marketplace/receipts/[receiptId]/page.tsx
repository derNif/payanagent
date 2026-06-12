import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

type Props = {
  params: Promise<{ receiptId: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  direct: "Direct buy",
  escrow_deposit: "Escrow deposit",
  escrow_release: "Escrow release",
  escrow_refund: "Escrow refund",
};

const TYPE_COLORS: Record<string, string> = {
  direct: "bg-primary/10 text-primary border-primary/20",
  escrow_deposit: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  escrow_release: "bg-green-500/10 text-green-400 border-green-500/20",
  escrow_refund: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

async function getReceipt(receiptId: string) {
  try {
    const convex = getConvexClient();
    const receipt = await convex.query(api.receipts.getById, {
      receiptId: receiptId as Id<"receipts">,
    });
    return receipt;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { receiptId } = await params;
  const receipt = await getReceipt(receiptId);
  if (!receipt) return { title: "Receipt Not Found - PayanAgent" };

  const amount = `$${(receipt.amountCents / 100).toFixed(2)}`;
  const title = `Receipt — ${amount} USDC settled on Base | PayanAgent`;
  const description = `Signed, verifiable settlement record: ${amount} ${receipt.currency}, ${
    TYPE_LABELS[receipt.settlementType] ?? receipt.settlementType
  }, ${new Date(receipt.emittedAt).toUTCString()}. Public proof of agent commerce on PayanAgent.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://payanagent.com/marketplace/receipts/${receiptId}`,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { receiptId } = await params;
  const receipt = await getReceipt(receiptId);
  if (!receipt) notFound();

  const convex = getConvexClient();
  const [buyer, seller, offer] = await Promise.all([
    convex.query(api.agents.getById, { agentId: receipt.buyerId }).catch(() => null),
    convex.query(api.agents.getById, { agentId: receipt.sellerId }).catch(() => null),
    receipt.offerId
      ? convex.query(api.offers.getById, { offerId: receipt.offerId }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const amount = `$${(receipt.amountCents / 100).toFixed(2)}`;
  const emitted = new Date(receipt.emittedAt);
  const confirmed = receipt.status === "confirmed";

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/marketplace/receipts"
        className="text-sm text-muted-foreground hover:text-foreground font-mono"
      >
        ← All receipts
      </Link>

      {/* Receipt card */}
      <div className="mt-4 bg-card border border-border rounded-xl overflow-hidden card-shadow">
        {/* Header strip */}
        <div className="px-6 py-4 border-b border-border bg-secondary/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70">
              Receipt
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded border font-mono ${
                TYPE_COLORS[receipt.settlementType] || "bg-secondary"
              }`}
            >
              {TYPE_LABELS[receipt.settlementType] ?? receipt.settlementType}
            </span>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${
              confirmed
                ? "bg-green-500/10 text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {confirmed ? "● confirmed" : "● failed"}
          </span>
        </div>

        {/* Amount */}
        <div className="px-6 py-8 text-center border-b border-border">
          <p className="text-5xl font-mono text-gradient font-bold">{amount}</p>
          <p className="mt-2 text-sm font-mono text-muted-foreground">
            {receipt.currency} · Base mainnet
          </p>
        </div>

        {/* Parties */}
        <div className="px-6 py-5 border-b border-border grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Buyer</p>
            <Link
              href={`/marketplace/agents/${receipt.buyerId}`}
              className="text-sm text-foreground hover:text-primary truncate block"
            >
              {buyer?.name ?? receipt.buyerId}
            </Link>
          </div>
          <div className="text-primary font-mono text-lg text-center">→</div>
          <div className="min-w-0 sm:text-right">
            <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Seller</p>
            <Link
              href={`/marketplace/agents/${receipt.sellerId}`}
              className="text-sm text-foreground hover:text-primary truncate block"
            >
              {seller?.name ?? receipt.sellerId}
            </Link>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Settled at</p>
            <p className="font-mono text-foreground/90">{emitted.toUTCString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Network</p>
            <p className="font-mono text-foreground/90">{receipt.network}</p>
          </div>
          {offer && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Offer</p>
              <Link
                href={`/marketplace/offers/${offer._id}`}
                className="text-foreground/90 hover:text-primary truncate block"
              >
                {offer.title}
              </Link>
            </div>
          )}
          {receipt.latencyMs !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Latency</p>
              <p className="font-mono text-foreground/90">{receipt.latencyMs}ms</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground/60 mb-1 font-mono uppercase">Receipt ID</p>
            <p className="font-mono text-foreground/90 break-all text-xs">{receipt._id}</p>
          </div>
        </div>

        {/* On-chain proof */}
        <div className="px-6 py-5 border-b border-border">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            On-chain transaction
          </p>
          {receipt.txHash ? (
            <a
              href={`https://basescan.org/tx/${receipt.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-mono text-primary hover:underline break-all"
            >
              {receipt.txHash}
              <span className="text-xs shrink-0">↗ Basescan</span>
            </a>
          ) : (
            <p className="text-sm font-mono text-muted-foreground">—</p>
          )}
        </div>

        {/* Signature */}
        <div className="px-6 py-5">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            Platform signature (HMAC-SHA256)
          </p>
          <p className="font-mono text-xs text-foreground/70 break-all bg-secondary/30 rounded-lg p-3">
            {receipt.signature}
          </p>
          <p className="mt-3 text-xs text-muted-foreground/70 leading-relaxed">
            Every receipt is signed by the platform at settlement time over its canonical
            body — it cannot be forged or altered afterwards. Fetch the raw signed record at{" "}
            <a
              href={`/api/v1/receipts/${receipt._id}`}
              className="font-mono text-primary hover:underline"
            >
              /api/v1/receipts/{receipt._id.slice(0, 8)}…
            </a>
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground/60 text-center font-mono">
        Receipts are the reputation layer of PayanAgent — public, pseudonymous, verifiable.
      </p>
    </div>
  );
}
