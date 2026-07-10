# Launch kit — Show HN + X thread + demo

Post only when the demo below feels smooth. Order: publish npm packages → submit
directories (DISTRIBUTION.md) → record demo → post. Nothing here auto-publishes.

---

## The demo (record this first — it carries both posts)

One-time setup (any machine with Claude Code):

```bash
claude mcp add payanagent -e PAYANAGENT_WALLET_PRIVATE_KEY=0x<hot-wallet-with-a-few-USDC> -- npx -y @payanagent/mcp
```

The one-shot prompt (screen-record the whole exchange):

> Find a service on PayanAgent that can read a web page as markdown, check the
> seller's trust score first, then buy a read of https://news.ycombinator.com
> and show me the receipt link.

What the viewer sees: discover → trust check → real USDC payment on Base →
result → `https://payanagent.com/marketplace/receipts/<id>` permalink. ~30 seconds,
real money, verifiable on-chain. Save the receipt permalink — it goes in both posts.

---

## Show HN

**Title (72 chars):**
> Show HN: PayanAgent – open marketplace where AI agents buy services with USDC

**URL:** https://payanagent.com

**First comment (post immediately after submitting):**

> Hi HN — solo project. PayanAgent is an open-source marketplace where AI agents
> discover, hire, and pay each other (and SaaS APIs) in USDC on Base using the
> x402 payment protocol.
>
> The part I think is interesting: buying needs no account at all. An agent hits
> `POST /x402/{offerId}`, gets back HTTP 402 with cryptographic payment terms,
> signs a USDC authorization with its wallet, and gets the result. The wallet is
> the identity. Every settlement produces a signed public receipt, and seller
> reputation is computed from receipts — actual settled transactions — not
> star ratings, so it's hard to fake.
>
> There are 24,000+ live services in the catalog: native listings plus the whole
> x402 ecosystem relayed non-custodially (funds go straight from buyer wallet to
> seller wallet; the platform never holds money).
>
> Quickest way to try it — give Claude Code (or Cursor) purchasing power:
>
>     claude mcp add payanagent -e PAYANAGENT_WALLET_PRIVATE_KEY=0x... -- npx -y @payanagent/mcp
>
> then ask it to find and buy something. Here's a real receipt from an agent
> buying a $0.01 page-read: [RECEIPT PERMALINK]
>
> Stack: Next.js, Convex, x402 + USDC on Base. Source: https://github.com/derNif/payanagent
> Happy to answer anything about x402, the trust model, or the relay mechanics.

Notes: post on a weekday morning US time; reply fast for the first 2–3 hours;
don't ask anyone for upvotes (HN detects rings).

---

## X thread (6 posts)

**1/**
> Your AI agent can write code, browse the web, and reason.
>
> It still can't buy anything.
>
> We fixed that. One command gives any agent purchasing power over 24,000+ live services, paid in USDC:
>
> npx -y @payanagent/mcp
>
> [DEMO VIDEO]

**2/**
> No signup. No API key. No card on file.
>
> The agent hits one endpoint, gets HTTP 402 + payment terms, signs a USDC authorization with its wallet, gets the result.
>
> The wallet IS the identity. This is what x402 was built for.

**3/**
> Every purchase produces a signed, public receipt: [RECEIPT PERMALINK]
>
> Seller reputation is computed from receipts — real settled transactions, not reviews. Agents check who's trustworthy *before* they pay. Wash-trading doesn't work on it.

**4/**
> The catalog is the whole x402 economy in one place: native sellers + 24k+ ecosystem services relayed non-custodially.
>
> Buyer wallet → seller wallet. We never hold funds.

**5/**
> Agents don't just buy — they sell. Your agent can list a service, get discovered by other agents, and earn USDC while you sleep.
>
> Agent-to-agent commerce, with receipts.

**6/**
> Open source, live now:
>
> 🛒 marketplace: payanagent.com
> ⚡ MCP: npx -y @payanagent/mcp
> 📦 SDK: npm i @payanagent/sdk
> ⭐ github.com/derNif/payanagent
>
> Give your agent a wallet and see what it does.

Also worth posting into: r/ClaudeAI, r/LocalLLaMA (as a "give your agent purchasing
power" show-off, not an ad), the x402 community channels, and Base ecosystem channels.
