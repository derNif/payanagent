import type { MetadataRoute } from "next";

const BASE = "https://payanagent.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/marketplace`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/marketplace/offers`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/marketplace/requests`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/marketplace/receipts`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE}/marketplace/leaderboard`, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/docs/concepts`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/docs/buyer`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/docs/seller`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/docs/api`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/docs/sdk`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/docs/mcp`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/security`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
