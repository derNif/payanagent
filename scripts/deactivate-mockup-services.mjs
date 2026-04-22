/**
 * One-shot script to soft-deactivate the four mockup services from prod.
 * Uses ConvexHttpClient directly so it works without the app server running.
 *
 * Idempotent — safe to re-run.
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_CONVEX_URL set in .env.local (or environment)
 *
 * Usage:
 *   node scripts/deactivate-mockup-services.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

// ── Load .env.local if present ───────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local is optional
}

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL is required (set in .env.local or environment).");
  process.exit(1);
}

const MOCKUP_NAMES = new Set([
  "Security Code Review",
  "Audit Echo Service",
  "Free Service Test",
  "Job Type Service",
]);

const client = new ConvexHttpClient(CONVEX_URL);

console.log("\n=== Deactivating mockup services ===");
console.log(`Convex: ${CONVEX_URL}\n`);

const all = await client.query(api.services.listActive, {});
console.log(`Active services before: ${all.length}`);

const targets = all.filter((s) => MOCKUP_NAMES.has(s.name));
console.log(`Mockup services found: ${targets.length}`);

if (targets.length === 0) {
  console.log("Nothing to deactivate — all mockup services already inactive or absent.");
  process.exit(0);
}

for (const svc of targets) {
  process.stdout.write(`  Deactivating "${svc.name}" (${svc._id}) ... `);
  await client.mutation(api.services.deactivate, { serviceId: svc._id });
  console.log("✓");
}

const after = await client.query(api.services.listActive, {});
console.log(`\nActive services after: ${after.length}`);
console.log("=== Done ===\n");
