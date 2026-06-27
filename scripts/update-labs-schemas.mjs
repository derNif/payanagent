// Upgrade the PayanAgent Labs offers' input/output schemas from friendly
// examples to real JSON Schema, so (a) the pay-then-fail validator can guard
// them and (b) /openapi.json advertises rich schemas. Matches existing offers
// by title. Usage: node scripts/update-labs-schemas.mjs <convexUrl> <sellerId>
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const [, , convexUrl, sellerId] = process.argv;
if (!convexUrl || !sellerId) {
  console.error("usage: node scripts/update-labs-schemas.mjs <convexUrl> <sellerId>");
  process.exit(1);
}
const client = new ConvexHttpClient(convexUrl);

const S = (o) => JSON.stringify(o);
const SCHEMAS = {
  "Web search": {
    input: S({ type: "object", properties: { query: { type: "string", description: "Search query" }, search_type: { type: "string", description: "general | news | shopping | videos | images | scholar" }, recency: { type: "string", description: "hour | day | week | month | year" } }, required: ["query"] }),
    output: S({ type: "object", properties: { results: { type: "array", items: { type: "object" } } }, required: ["results"] }),
  },
  "Cited answer (web-grounded)": {
    input: S({ type: "object", properties: { query: { type: "string" }, search_type: { type: "string" }, date_filter: { type: "string" } }, required: ["query"] }),
    output: S({ type: "object", properties: { answer: { type: "string" }, sources: { type: "array", items: { type: "object" } } }, required: ["answer"] }),
  },
  "Read a page as markdown": {
    input: S({ type: "object", properties: { url: { type: "string", description: "Page URL" }, main_content_only: { type: "boolean" } }, required: ["url"] }),
    output: S({ type: "object", properties: { url: { type: "string" }, title: { type: "string" }, markdown: { type: "string" } }, required: ["markdown"] }),
  },
  "Map a website's URLs": {
    input: S({ type: "object", properties: { url: { type: "string" }, search: { type: "string" }, limit: { type: "integer" } }, required: ["url"] }),
    output: S({ type: "object", properties: { links: { type: "array", items: { type: "object" } } }, required: ["links"] }),
  },
  "Extract text from a PDF": {
    input: S({ type: "object", properties: { url: { type: "string", description: "Direct PDF URL" } }, required: ["url"] }),
    output: S({ type: "object", properties: { url: { type: "string" }, pages: { type: "integer" }, text: { type: "string" } }, required: ["text"] }),
  },
};

const offers = await client.query(anyApi.offers.listBySeller, { sellerId, includeInactive: true });
for (const o of offers) {
  const s = SCHEMAS[o.title];
  if (!s) continue;
  await client.mutation(anyApi.offers.update, { offerId: o._id, inputSchema: s.input, outputSchema: s.output });
  console.log(`updated schemas: ${o.title}  ${o._id}`);
}
console.log("done.");
