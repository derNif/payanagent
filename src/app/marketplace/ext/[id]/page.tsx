import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

type Props = { params: Promise<{ id: string }> };

async function getResource(id: string) {
  try {
    const convex = getConvexClient();
    return await convex.query(api.aggregator.getExternalById, {
      id: id as Id<"externalResources">,
    });
  } catch {
    return null;
  }
}

function priceUsd(priceUsd: number | undefined, amountRaw: string): number {
  return priceUsd ?? Number(amountRaw) / 1e6;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await getResource(id);
  if (!r) return { title: "Resource Not Found — PayanAgent" };
  const title = `${r.serviceName || "x402 resource"} — PayanAgent Ecosystem`;
  const description = `${r.description.slice(0, 160)} — discoverable and buyable in USDC through PayanAgent.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ExternalResourcePage({ params }: Props) {
  const { id } = await params;
  const r = await getResource(id);
  if (!r) notFound();

  const base = r.network === "eip155:8453" || r.network === "base";
  const price = priceUsd(r.priceUsd, r.amountRaw);
  const priceStr =
    !Number.isFinite(price) || price === 0
      ? "free / unknown"
      : price < 0.01
        ? `$${price.toFixed(4)}`
        : `$${price.toFixed(2)}`;

  const buySnippet = `# Buy THROUGH PayanAgent (same /x402/:id as any offer):
curl -X POST https://payanagent.com/x402/${id} \\
  -H 'Content-Type: application/json' -d '{}'
# First call returns HTTP 402 with the seller's x402 challenge — sign and retry,
# or let @x402/fetch handle it. A signed receipt is emitted on delivery.`;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/marketplace/ext"
        className="text-sm text-muted-foreground hover:text-foreground font-mono"
      >
        ← Ecosystem
      </Link>

      <div className="mt-4 bg-card border border-border rounded-xl overflow-hidden card-shadow">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-secondary/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70">
              External resource
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">
              via Bazaar
            </span>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${
              base ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
            }`}
          >
            {base ? "● buyable here" : "● discovery only"}
          </span>
        </div>

        {/* Title + price */}
        <div className="px-6 py-8 text-center border-b border-border">
          <h1 className="text-2xl font-bold text-foreground mb-3">
            {r.serviceName || "x402 resource"}
          </h1>
          <p className="text-5xl font-mono text-gradient font-bold">{priceStr}</p>
          <p className="mt-2 text-sm font-mono text-muted-foreground">
            USDC · per call ·{" "}
            {r.network === "eip155:8453" || r.network === "base"
              ? "Base"
              : r.network}
          </p>
        </div>

        {/* Description */}
        <div className="px-6 py-5 border-b border-border">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            What it does
          </p>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">
            {r.description}
          </p>
          {r.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {r.tags.map((tag) => (
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

        {/* Schemas */}
        {(r.inputSchema || r.outputSchema) && (
          <div className="px-6 py-5 border-b border-border space-y-4">
            {r.inputSchema && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
                  Input
                </p>
                <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {r.inputSchema}
                </pre>
              </div>
            )}
            {r.outputSchema && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
                  Output
                </p>
                <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {r.outputSchema}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Origin + seller */}
        <div className="px-6 py-5 border-b border-border space-y-1 text-xs font-mono text-muted-foreground/70">
          <p className="break-all">
            origin:{" "}
            <a href={r.resource} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {r.resource}
            </a>
          </p>
          <p className="break-all">seller wallet (payTo): {r.payTo}</p>
        </div>

        {/* Buy */}
        <div className="px-6 py-5">
          <p className="text-xs text-muted-foreground/60 mb-2 font-mono uppercase">
            {base ? "Buy it through PayanAgent" : "Not yet routable"}
          </p>
          {base ? (
            <>
              <pre className="font-mono text-xs text-foreground/80 bg-secondary/30 p-3 overflow-x-auto">
                {buySnippet}
              </pre>
              <p className="mt-3 text-xs text-muted-foreground/70 leading-relaxed">
                Payment settles buyer → seller directly in USDC on Base — PayanAgent
                relays the call and emits a signed{" "}
                <Link href="/marketplace/receipts" className="text-primary hover:underline">
                  receipt
                </Link>
                , never holding the funds.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground/70 leading-relaxed">
              This resource is on {r.network}. PayanAgent currently routes only Base
              (eip155:8453) resources; it&apos;s listed here for discovery.
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground/60 text-center font-mono">
        resource id: {r._id}
      </p>
    </div>
  );
}
