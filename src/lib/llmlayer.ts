// Server-side wrapper for the llmlayer.dev web-APIs that back PayanAgent Labs
// offers. The key is server-only and never leaves this module. Buyer-facing
// output is cleaned of all billing/vendor metadata (cost, tokens, model) so the
// service is white-labeled — buyers see the result, not the backend.

const BASE = "https://api.llmlayer.dev";

function apiKey(): string {
  const k = process.env.LLMLAYER_API_KEY;
  if (!k) throw new Error("LLMLAYER_API_KEY not configured");
  return k;
}

type Json = Record<string, unknown>;

async function call(path: string, body: Json): Promise<Json> {
  // Drop undefined keys so we send a clean payload.
  const payload: Json = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) payload[k] = v;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: Json;
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const detail = json.detail as { message?: string } | undefined;
    const msg =
      detail?.message ||
      (typeof json.error === "string" ? json.error : "") ||
      `upstream error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// Each handler validates the buyer's input, calls llmlayer, and returns clean
// output. Throwing here surfaces as a 502 (with the receipt id) to the buyer.
export const handlers: Record<string, (input: Json) => Promise<Json>> = {
  async search(input) {
    const query = String(input.query ?? "").trim();
    if (!query) throw new Error("`query` is required");
    const r = await call("/api/v2/web_search", {
      query,
      search_type: input.search_type ?? "general",
      location: input.location ?? "us",
      recency: input.recency,
      domain_filter: input.domain_filter,
    });
    return { results: r.results ?? [] };
  },

  async answer(input) {
    const query = String(input.query ?? "").trim();
    if (!query) throw new Error("`query` is required");
    const r = await call("/api/v2/answer", {
      query,
      model: "llmlayer-web",
      citations: true,
      return_sources: true,
      search_type: input.search_type ?? "general",
      date_filter: input.date_filter ?? "anytime",
    });
    return { answer: r.answer ?? "", sources: r.sources ?? [] };
  },

  async read(input) {
    const url = String(input.url ?? "").trim();
    if (!url) throw new Error("`url` is required");
    const r = await call("/api/v2/scrape", {
      url,
      formats: ["markdown"],
      main_content_only: input.main_content_only ?? true,
    });
    return { url: r.url ?? url, title: r.title ?? null, markdown: r.markdown ?? "" };
  },

  async map(input) {
    const url = String(input.url ?? "").trim();
    if (!url) throw new Error("`url` is required");
    const r = await call("/api/v2/map", {
      url,
      search: input.search,
      limit: typeof input.limit === "number" ? input.limit : 100,
    });
    return { links: r.links ?? [] };
  },

  async pdf(input) {
    const url = String(input.url ?? "").trim();
    if (!url) throw new Error("`url` is required");
    const r = await call("/api/v2/get_pdf_content", { url });
    return { url: r.url ?? url, pages: r.pages ?? null, text: r.text ?? "" };
  },
};

// tool is the part after "llmlayer:" in an offer's internalHandler id.
export async function runLlmlayer(tool: string, input: Json): Promise<Json> {
  const fn = handlers[tool];
  if (!fn) throw new Error(`unknown llmlayer tool: ${tool}`);
  return fn(input);
}
