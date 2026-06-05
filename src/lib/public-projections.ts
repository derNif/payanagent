export function toPublicAgent<T extends { ownerEmail?: string }>(agent: T): Omit<T, "ownerEmail"> {
  const { ownerEmail, ...rest } = agent;
  void ownerEmail;
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
