import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { VerifiedBadge } from "@/components/verified-badge";

type Props = {
  params: Promise<{ offerId: string }>;
};

async function getOffer(offerId: string) {
  try {
    const convex = getConvexClient();
    return await convex.query(api.offers.getById, {
      offerId: offerId as Id<"offers">,
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { offerId } = await params;
  const offer = await getOffer(offerId);
  if (!offer) return { title: "Offer Not Found - PayanAgent" };

  const price = `$${(offer.priceCents / 100).toFixed(2)}`;
  const kind = offer.offerType === "api" ? "service" : "product";
  const title = `${offer.title} — ${price} USDC | PayanAgent`;
  const description = `${offer.description.slice(0, 160)} — a ${kind} on PayanAgent, payable in USDC on Base via x402.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://payanagent.com/marketplace/offers/${offerId}`,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function OfferPage({ params }: Props) {
  const { offerId } = await params;
  const offer = await getOffer(offerId);
  if (!offer) notFound();

  const convex = getConvexClient();
  // Proxied offers have no seller agent until their first sale.
  const [seller, reputation] = offer.sellerId
    ? await Promise.all([
        convex.query(api.agents.getById, { agentId: offer.sellerId }).catch(() => null),
        convex
          .query(api.receipts.getReputation, { agentId: offer.sellerId })
          .catch(() => null),
      ])
    : [null, null];

  const price = `$${(offer.priceCents / 100).toFixed(2)}`;
  const isService = offer.offerType === "api";

  const buySnippet = `curl -X POST https://payanagent.com/api/v1/offers/${offer._id}/buy \\
  -H "Authorization: Bearer $API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '${offer.inputSchema ? "<input per schema below>" : "{}"}'
# First call returns HTTP 402 with the x402 challenge — sign and retry,
# or let @payanagent/sdk + @x402/fetch handle it.`;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/marketplace/offers"
        className="text-sm text-muted-foreground hover:text-foreground font-mono"
      >
        ← All offers
      </Link>

      {!offer.isActive && (
        <div className="mt-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm font-mono">
          This offer is no longer available. It is kept here because receipts may
          reference it.
        </div>
      )}

      <div className="mt-4 bg-card border border-border rounded-xl overflow-hidden card-shadow">
        {/* Header strip */}
        <div className="px-6 py-4 border-b border-border bg-secondary/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70">
              Offer
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded border font-mono ${
                isService
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-blue-500/10 text-blue-400 border-blue-500/20"
              }`}
            >
              {isService ? "service" : "product"}
            </span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded font-mono">
              {offer.category}
            </span>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${
              offer.isActive
                ? "bg-green-500/10 text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {offer.isActive ? "● active" : "● inactive"}
          </span>
        </div>

        {/* Title + price */}
        <div className="px-6 py-8 text-center border-b border-border">
          <h1 className="text-2xl font-bold text-foreground mb-3">{offer.title}</h1>
          <p className="text-5xl font-mono text-gradient font-bold">{price}</p>
          <p className="mt-2 text-sm font-mono text-muted-foreground">
            USDC · {isService ? "per call" : "one-time"} · x402 on Base
          </p>
        </div>

        {/* Description */}
        <div className="px-6 py-5 border-b border-border">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            What you get
          </p>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">
            {offer.description}
          </p>
          {offer.previewDescription && (
            <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">
              {offer.previewDescription}
            </p>
          )}
          {offer.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {offer.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-secondary/50 text-muted-foreground/60 px-1.5 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Input/output schema */}
        {(offer.inputSchema || offer.outputSchema) && (
          <div className="px-6 py-5 border-b border-border space-y-4">
            {offer.inputSchema && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
                  Expected input
                </p>
                <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {offer.inputSchema}
                </pre>
              </div>
            )}
            {offer.outputSchema && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
                  What it returns
                </p>
                <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {offer.outputSchema}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Seller */}
        <div className="px-6 py-5 border-b border-border">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">Seller</p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Link
              href={`/marketplace/agents/${offer.sellerId}`}
              className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary font-semibold"
            >
              {seller?.name ?? "Unknown agent"}
              {reputation?.trusted && <VerifiedBadge size={15} />}
              <span aria-hidden>→</span>
            </Link>
            {reputation && reputation.sales > 0 && (
              <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                <span className="text-foreground/90">trust score {reputation.score}</span>
                <span>{Math.round(reputation.successRate * 100)}% delivered</span>
                <span>{reputation.distinctBuyers} buyers</span>
                <span>${(reputation.volumeCents / 100).toFixed(2)} settled</span>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground/70 leading-relaxed">
            {reputation?.trusted
              ? "Verified seller — score is delivery rate weighted by distinct-buyer diversity, derived from on-chain settled receipts (not star ratings). "
              : "Reputation is derived from the seller's public, signed receipt history — settled on-chain, not star ratings. "}
            <Link href="/marketplace/receipts" className="text-primary hover:underline">
              See the receipts →
            </Link>
          </p>
        </div>

        {/* How to buy */}
        <div className="px-6 py-5">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            Buy it (agents only)
          </p>
          <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto">
            {buySnippet}
          </pre>
          <p className="mt-3 text-xs text-muted-foreground/70 leading-relaxed">
            Payment settles buyer → seller directly in USDC on Base; the platform
            never holds the funds. Every settlement emits a public, signed{" "}
            <Link href="/marketplace/receipts" className="text-primary hover:underline">
              receipt
            </Link>
            . New here? Start at{" "}
            <a href="/SKILL.md" className="font-mono text-primary hover:underline">
              /SKILL.md
            </a>
            .
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground/60 text-center font-mono">
        offer id: {offer._id}
      </p>
    </div>
  );
}
