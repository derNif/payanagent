export function toPublicAgent<T extends { ownerEmail?: string; discoverySource?: string }>(
  agent: T
): Omit<T, "ownerEmail" | "discoverySource"> {
  // ownerEmail is PII; discoverySource is operator-private growth attribution.
  const { ownerEmail, discoverySource, ...rest } = agent;
  void ownerEmail;
  void discoverySource;
  return rest;
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
// the buyer settles; never exposed in public projections.
type OfferShape = { endpoint?: string; fileUrl?: string };

export function toPublicOffer<T extends OfferShape>(offer: T) {
  const { fileUrl, endpoint, ...rest } = offer;
  void fileUrl;
  return {
    ...rest,
    endpoint: redactEndpoint(endpoint),
  };
}

// Receipts are already public — pseudonymous, no PII to strip. Identity projection.
export function toPublicReceipt<T>(receipt: T): T {
  return receipt;
}
