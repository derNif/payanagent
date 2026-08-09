// Admin access check, shared by the edge proxy and the /admin page itself.
// The page re-checks because a proxy/middleware-layer gate is the wrong place
// to hold the *only* authorization decision (Next has shipped several
// middleware-bypass advisories); a route that renders agent PII must gate
// itself too.
//
// Comparison is length-independent and constant-time over the expected key, and
// avoids node:crypto so the same helper runs in the edge proxy.
export function isAdminKeyValid(provided: string | null | undefined): boolean {
  const expected = process.env.ADMIN_KEY;
  if (!expected || !provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i] ?? 0) ^ b[i];
  }
  return diff === 0;
}
