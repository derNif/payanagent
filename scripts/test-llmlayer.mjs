// Validate llmlayer endpoints we intend to wrap. Reads LLMLAYER_API_KEY from env.
// Spends a few cents of credits (one cheap call each). Run: node scripts/test-llmlayer.mjs
import { readFileSync } from "node:fs";

// load key from .env.local without a dep
let KEY = process.env.LLMLAYER_API_KEY;
if (!KEY) {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  KEY = env.match(/^LLMLAYER_API_KEY=(.+)$/m)?.[1]?.trim();
}
if (!KEY) throw new Error("LLMLAYER_API_KEY not found");

const BASE = "https://api.llmlayer.dev";
const call = async (path, body) => {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ms: Date.now() - t, json };
};

const show = (label, r, keys) => {
  const cost = r.json?.cost ?? r.json?.llmlayer_cost ?? "?";
  console.log(`\n=== ${label} === [${r.status}] ${r.ms}ms  cost=$${cost}`);
  if (r.status !== 200) { console.log("  ERR:", JSON.stringify(r.json).slice(0, 300)); return; }
  for (const k of keys) {
    const v = r.json?.[k];
    const s = typeof v === "string" ? v.slice(0, 120) : JSON.stringify(v)?.slice(0, 200);
    console.log(`  ${k}: ${s}`);
  }
};

show("web_search", await call("/api/v2/web_search", { query: "x402 protocol" }), ["results", "cost"]);
show("answer", await call("/api/v2/answer", { query: "What is the x402 payment protocol in one sentence?", model: "llmlayer-web", citations: true, return_sources: true }), ["answer", "sources", "llmlayer_cost"]);
show("scrape", await call("/api/v2/scrape", { url: "https://example.com", formats: ["markdown"], main_content_only: true }), ["markdown", "title", "cost"]);
show("map", await call("/api/v2/map", { url: "https://example.com", limit: 10 }), ["links", "cost"]);
show("youtube_transcript", await call("/api/v2/youtube_transcript", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), ["transcript", "title", "cost"]);
show("get_pdf_content", await call("/api/v2/get_pdf_content", { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" }), ["text", "pages", "cost"]);

console.log("\ndone.");
