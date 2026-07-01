// Defense-in-depth REST projection. The Convex public queries already strip
// these, but stripping again at the HTTP boundary is cheap and covers any raw
// doc that reaches a route. Accepts full or already-projected inputs.
export function toPublicAgent<T extends object>(
  agent: T
): Omit<T, "ownerEmail" | "discoverySource"> {
  const { ownerEmail, discoverySource, ...rest } = agent as Record<string, unknown>;
  void ownerEmail;
  void discoverySource;
  return rest as Omit<T, "ownerEmail" | "discoverySource">;
}

type EndpointBearing = { endpoint?: string };

const SECRET_QUERY_PARAM =
  /^(?:access[_-]?token|api[_-]?key|auth|authorization|bearer|client[_-]?secret|code|key|password|private[_-]?key|secret|session|sig|signature|token|jwt)$/i;
const SECRET_LIKE_VALUE = /^(?=.{24,}$)(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9._~+/=-]+$/;

function redactEndpoint(endpoint?: string) {
  if (!endpoint) return endpoint;

  try {
    const url = new URL(endpoint);

    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";

    for (const [key, value] of Array.from(url.searchParams.entries())) {
      if (SECRET_QUERY_PARAM.test(key) || SECRET_LIKE_VALUE.test(value)) {
        url.searchParams.set(key, "REDACTED");
      }
    }

    return url.toString();
  } catch {
    return endpoint;
  }
}

export function toPublicService<T extends EndpointBearing>(
  service: T
): Omit<T, "endpoint"> & { endpoint?: string } {
  return {
    ...service,
    endpoint: redactEndpoint(service.endpoint),
  };
}

// Offers — same endpoint-redaction logic as services. fileUrl is private until
// the buyer settles; never exposed in public projections. internalHandler names
// the PayanAgent-operated backend (e.g. "labs:search") — stripped entirely
// so the backing provider stays private.
export function toPublicOffer<T extends object>(offer: T) {
  const { fileUrl, endpoint, internalHandler, externalUrl, source, ...rest } =
    offer as Record<string, unknown>;
  void fileUrl;
  void internalHandler;
  // externalUrl/source reveal that we relay a proxied offer — strip them so a
  // proxied offer is indistinguishable from a native one to customers.
  void externalUrl;
  void source;
  const amountRaw = (rest as { amountRaw?: string }).amountRaw;
  const priceCents = (rest as { priceCents?: number }).priceCents ?? 0;
  return {
    ...rest,
    // Exact USD price — sub-cent aware (priceCents rounds $0.001 to 0).
    priceUsd: amountRaw ? Number(amountRaw) / 1e6 : priceCents / 100,
    endpoint: redactEndpoint(endpoint as string | undefined),
  };
}

// Receipts are already public — pseudonymous, no PII to strip. Identity projection.
export function toPublicReceipt<T>(receipt: T): T {
  return receipt;
}
