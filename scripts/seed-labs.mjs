// Seed the PayanAgent Labs offer shelf (llmlayer-backed) on a Convex deployment.
// Usage: node scripts/seed-labs.mjs <convexUrl> <sellerId>
//   convexUrl: e.g. dev NEXT_PUBLIC_CONVEX_URL or prod URL
//   sellerId:  the PayanAgent Labs agent _id on that deployment
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const [, , convexUrl, sellerId] = process.argv;
if (!convexUrl || !sellerId) {
  console.error("usage: node scripts/seed-labs.mjs <convexUrl> <sellerId>");
  process.exit(1);
}

const client = new ConvexHttpClient(convexUrl);

// priceCents are integer cents. Markups ≈10× over llmlayer's per-call cost.
const OFFERS = [
  {
    title: "Web search",
    description:
      "Search the live web and get back ranked results (title, link, snippet) — no search-engine API key, no signup. One paid call, fresh results.",
    category: "Web",
    tags: ["search", "web", "research"],
    priceCents: 2,
    internalHandler: "llmlayer:search",
    inputSchema:
      '{"query":"your search query","search_type":"general | news | shopping | videos | images | scholar (optional, default general)","recency":"hour | day | week | month | year (optional)"}',
    outputSchema: '{"results":[{"title":"...","link":"...","snippet":"..."}]}',
  },
  {
    title: "Cited answer (web-grounded)",
    description:
      "Ask a question, get a web-grounded answer in markdown with inline citations and the sources used. Saves your agent the search-read-synthesize loop.",
    category: "Web",
    tags: ["answer", "rag", "research", "search"],
    priceCents: 5,
    internalHandler: "llmlayer:answer",
    inputSchema:
      '{"query":"your question","search_type":"general | news (optional)","date_filter":"anytime | day | week | month | year (optional)"}',
    outputSchema:
      '{"answer":"markdown answer with inline citations","sources":[{"title":"...","link":"..."}]}',
  },
  {
    title: "Read a page as markdown",
    description:
      "Give a URL, get clean LLM-ready markdown of the page — handles JS-rendered sites. No scraping setup, no browser.",
    category: "Web",
    tags: ["read", "scrape", "markdown", "web"],
    priceCents: 1,
    internalHandler: "llmlayer:read",
    inputSchema:
      '{"url":"https://page-to-read.com","main_content_only":true}',
    outputSchema: '{"url":"...","title":"...","markdown":"clean markdown of the page"}',
  },
  {
    title: "Map a website's URLs",
    description:
      "Give a seed URL, get back the list of URLs on that site (with titles). Useful for discovering what to read or crawl next.",
    category: "Web",
    tags: ["map", "sitemap", "discover", "web"],
    priceCents: 2,
    internalHandler: "llmlayer:map",
    inputSchema:
      '{"url":"https://site.com","search":"optional filter string","limit":100}',
    outputSchema: '{"links":[{"url":"...","title":"..."}]}',
  },
  {
    title: "Extract text from a PDF",
    description:
      "Give a direct PDF URL, get back the full extracted text and page count. No PDF parsing on your end.",
    category: "Data",
    tags: ["pdf", "extract", "document", "text"],
    priceCents: 2,
    internalHandler: "llmlayer:pdf",
    inputSchema: '{"url":"https://example.com/file.pdf"}',
    outputSchema: '{"url":"...","pages":12,"text":"extracted text content"}',
  },
];

for (const o of OFFERS) {
  const id = await client.mutation(anyApi.offers.create, {
    sellerId,
    offerType: "api",
    ...o,
  });
  console.log(`created ${o.internalHandler.padEnd(18)} $${(o.priceCents / 100).toFixed(2)}  ${id}`);
}
console.log("done.");
