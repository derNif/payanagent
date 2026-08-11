const DEFAULT_APP_URL = "https://payanagent.com";

/**
 * Bind one public PayanAgent buy URL to the seller-owned relay target.
 *
 * A registered external URL may carry schema-valid example query parameters so
 * its ownership probe can reach the 402 boundary. When a buyer supplies query
 * parameters on the PayanAgent URL, those values are the actual call input and
 * replace the registration example. The target origin and path always remain
 * seller-registered.
 */
export function buildRelayUrls({
  requestUrl,
  externalUrl,
  offerId,
  appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
}: {
  requestUrl: string;
  externalUrl: string;
  offerId: string;
  appUrl?: string;
}): { canonicalUrl: string; sellerUrl: string } {
  const incoming = new URL(requestUrl);
  const seller = new URL(externalUrl);
  const canonical = new URL(`/x402/${offerId}`, appUrl);

  if (incoming.search) seller.search = incoming.search;
  canonical.search = incoming.search;

  return {
    canonicalUrl: canonical.toString(),
    sellerUrl: seller.toString(),
  };
}
