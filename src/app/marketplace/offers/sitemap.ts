import type { MetadataRoute } from "next";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { logError } from "@/lib/errors";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";

// Offer sitemap (served at /marketplace/offers/sitemap.xml) — the tiered SEO
// surface. Only offers with unique content are listed (native + anything with
// a real sale; see offers.listForSitemap); an offer's page enters the index
// automatically the moment it earns its first receipt.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const convex = getConvexClient();
    const offers = await convex.query(api.offers.listForSitemap, {});
    return offers.map((o) => ({
      url: `${APP_URL}/marketplace/offers/${o._id}`,
      lastModified: new Date(o.lastModified),
      changeFrequency: "weekly" as const,
    }));
  } catch (err) {
    // An empty sitemap beats a 500 — crawlers retry on their own schedule. It
    // also silently de-indexes the catalog, so the cause must be logged.
    logError("sitemap.offers:list", err);
    return [];
  }
}
