import { assertPublicHttpUrl } from "@/lib/ssrf";

// Server-side verification for seller-registered relay offers (issue #95): an
// already-x402-gated resource is only accepted if it actually answers with a
// 402 challenge carrying Base USDC terms. The extracted payTo is what binds the
// resource to the registering seller's wallet — the route enforces that match.

const BASE_NETWORKS = new Set(["eip155:8453", "base"]);
const USDC_ASSETS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base sepolia
]);

export type ExternalX402Terms = {
  payTo: string;
  asset: string;
  network: string;
  amountRaw: string;
};

// Sellers in the wild speak x402 v1 ("maxAmountRequired") and v2 ("amount"),
// with the challenge either in the JSON body or base64-encoded in a header.
// Accept any of those carriers; require an exact-scheme Base accept.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function termsFromAccepts(json: any): ExternalX402Terms | null {
  const accepts = json?.accepts;
  if (!Array.isArray(accepts)) return null;
  const base = accepts.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any) =>
      a &&
      a.scheme === "exact" &&
      BASE_NETWORKS.has(String(a.network)) &&
      typeof a.payTo === "string" &&
      a.payTo,
  );
  const pick =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    base.find((a: any) => USDC_ASSETS.has(String(a.asset).toLowerCase())) || base[0];
  if (!pick) return null;
  const amount = pick.amount ?? pick.maxAmountRequired;
  if (amount === undefined || amount === null) return null;
  return {
    payTo: String(pick.payTo),
    asset: String(pick.asset ?? ""),
    network: String(pick.network),
    amountRaw: String(amount),
  };
}

function decodeB64Json(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

// Probe the resource unauthenticated and unpaid. A real x402 gate answers 402
// with its terms before looking at the body, so an empty JSON body suffices for
// POST-style resources.
export async function probeX402Resource(
  url: string,
  method: string = "GET",
): Promise<ExternalX402Terms> {
  await assertPublicHttpUrl(url);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers:
        method === "GET"
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`could not reach ${url}`);
  }

  if (res.status !== 402) {
    throw new Error(
      `expected an HTTP 402 x402 challenge from ${method} ${url}, got ${res.status}. ` +
        `If the resource is gated on a different method, set httpMethod accordingly.`,
    );
  }

  for (const h of ["payment-required", "x-payment-required", "www-authenticate"]) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    const terms = termsFromAccepts(decodeB64Json(raw));
    if (terms) return terms;
  }

  try {
    const terms = termsFromAccepts(await res.json());
    if (terms) return terms;
  } catch {
    // fall through to the error below
  }

  throw new Error(
    "the 402 response carried no parseable x402 terms with an exact-scheme Base accept " +
      "(checked the payment-required/x-payment-required/www-authenticate headers and the JSON body)",
  );
}
