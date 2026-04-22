import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  render_js: z.boolean().default(false),
  premium_proxy: z.boolean().default(false),
  country_code: z.string().length(2).toLowerCase().optional(),
  wait: z.number().int().min(0).max(10000).optional(),
  block_resources: z.boolean().default(true),
});

// POST /api/v1/platform/scrapingbee
// Internal — called by the invoke route after x402 payment is settled.
// Clients interact through POST /api/v1/services/:serviceId/invoke.
export async function POST(request: NextRequest) {
  const internalKey = process.env.PLATFORM_INTERNAL_KEY;
  if (!internalKey || request.headers.get("x-platform-internal-key") !== internalKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ScrapingBee API key not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return NextResponse.json({ error: "Validation failed", details }, { status: 400 });
  }

  const { url, render_js, premium_proxy, country_code, wait, block_resources } = parsed.data;

  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    render_js: render_js ? "true" : "false",
    premium_proxy: premium_proxy ? "true" : "false",
    block_resources: block_resources ? "true" : "false",
  });
  if (country_code) params.set("country_code", country_code);
  if (wait !== undefined) params.set("wait", String(wait));

  const upstream = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream timeout";
    return NextResponse.json({ error: `ScrapingBee request failed: ${msg}` }, { status: 502 });
  }

  const content = await upstreamRes.text();

  if (!upstreamRes.ok) {
    return NextResponse.json(
      { error: "ScrapingBee upstream error", status_code: upstreamRes.status, details: content },
      { status: 502 }
    );
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "text/html";
  if (contentType.includes("application/json")) {
    try {
      return NextResponse.json({ content: JSON.parse(content), status_code: upstreamRes.status });
    } catch {
      // fall through to text response
    }
  }

  return NextResponse.json({ content, status_code: upstreamRes.status });
}
