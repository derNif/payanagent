# Distribution checklist — get the MCP everywhere agents live

Goal: `@payanagent/mcp` listed in every directory an agent (or its operator) looks in.
Everything below is free. Prerequisite for all of it: **PR #77 merged and both packages
published to npm** (`npm login`, then `npm publish` in `packages/mcp` and `packages/sdk`).

Paste-ready copy is at the bottom — same title/description everywhere for brand consistency.

---

## 1. Official MCP registry (do this first)

The registry at `registry.modelcontextprotocol.io` is the canonical index — PulseMCP,
Glama, and a growing set of clients auto-ingest from it. Publishing is instant
(schema validation + GitHub namespace auth, no human review).

The repo already contains `packages/mcp/server.json` and the npm package carries
`mcpName: io.github.dernif/payanagent`.

```powershell
# 1. Install the publisher CLI (grab the windows_amd64 binary):
#    https://github.com/modelcontextprotocol/registry/releases  → mcp-publisher_…_windows_amd64
# 2. From the repo:
cd packages/mcp
mcp-publisher login github      # device-code flow in the browser, as derNif
mcp-publisher publish           # reads server.json → done
```

Verify: `https://registry.modelcontextprotocol.io/v0/servers?search=payanagent`

## 2. Smithery — https://smithery.ai

Sign in with GitHub → add/claim the server (repo `derNif/payanagent`, subfolder
`packages/mcp`; `smithery.yaml` is already in the repo). Use the paste-ready copy below.

## 3. Cursor directory — https://cursor.directory

Submit via the site's MCP submit flow (or the PR route: github.com/pontusab/directories).
Config snippet for the listing:

```json
{
  "mcpServers": {
    "payanagent": {
      "command": "npx",
      "args": ["-y", "@payanagent/mcp"],
      "env": { "PAYANAGENT_WALLET_PRIVATE_KEY": "0x..." }
    }
  }
}
```

## 4. Cline marketplace — github.com/cline/mcp-marketplace

Open a "New MCP Server Submission" issue: repo URL `https://github.com/derNif/payanagent`
(note the `packages/mcp` subfolder), logo = `https://payanagent.com/icon.svg`, plus the
short description below.

## 5. Awesome lists (one-line PRs)

- **punkpeye/awesome-mcp-servers** — add under the Finance / Marketplaces section:
  `- [derNif/payanagent](https://github.com/derNif/payanagent) - Buy any of 24,000+ live x402 services with USDC on Base. Anonymous buys (wallet = identity), signed receipts, seller trust scores.`
- **awesome-x402 lists** — search GitHub for `awesome-x402`; same one-liner.

## 6. Coinbase x402 ecosystem — github.com/coinbase/x402

We're already on x402scan. Add PayanAgent to the x402.org ecosystem page: follow the
repo's CONTRIBUTING for ecosystem entries (one small PR: name, URL, category
"Marketplace", logo, one-liner below).

---

## Paste-ready copy

**Name:** PayanAgent

**One-liner (≤100 chars):**
> Buy any of 24,000+ live x402 services with USDC on Base — the open marketplace for the agent economy

**Short description:**
> PayanAgent gives your agent purchasing power. One MCP server to discover and buy from 24,000+ live x402 services (the whole ecosystem in one catalog) with USDC on Base — no account, no API key; the wallet is the identity. Every settlement produces a signed public receipt, and sellers carry receipt-derived trust scores so agents know who is safe to buy from before paying. Agents can also sell their own services and post/fulfill bespoke work with escrow.

**Tags:** `payments` `marketplace` `x402` `usdc` `base` `agent-economy` `commerce`

**Install:** `npx -y @payanagent/mcp`

**Links:** https://payanagent.com · https://github.com/derNif/payanagent · https://www.npmjs.com/package/@payanagent/mcp

---

## After submitting

- Track: npm weekly downloads, distinct buyer wallets, receipts volume, `discoverySource`.
- Add payanagent.com to Google Search Console to watch the sitemap/SEO channel arrive.
