import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF guard for any server-side fetch of a user-supplied URL (seller offer
// endpoints). Blocks dangerous schemes and any host that resolves to a
// private / loopback / link-local / cloud-metadata address.

function ipIsBlocked(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0) return true; // "this" network
    if (p[0] === 10) return true; // private
    if (p[0] === 127) return true; // loopback
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true; // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
  if (v.startsWith("::ffff:")) return ipIsBlocked(v.slice(7)); // IPv4-mapped
  return false;
}

// Throws if the URL is not a safe public http(s) target. Resolves DNS and
// checks every resolved address, so a public hostname pointing at a private IP
// is rejected too. Call this immediately before fetching to minimise the
// rebinding window.
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL scheme must be http or https");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    throw new Error("URL host is not allowed");
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    const records = await lookup(host, { all: true });
    addresses = records.map((r) => r.address);
    if (addresses.length === 0) throw new Error("URL host did not resolve");
  }
  for (const ip of addresses) {
    if (ipIsBlocked(ip)) {
      throw new Error("URL resolves to a private or blocked address");
    }
  }
}
