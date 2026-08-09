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
  if (v.startsWith("::ffff:")) {
    // IPv4-mapped, in dotted form (::ffff:127.0.0.1) or the hex form the URL
    // parser normalises it to (::ffff:7f00:1). Fail closed if neither parses.
    const rest = v.slice(7);
    if (isIP(rest) === 4) return ipIsBlocked(rest);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (!hex) return true;
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return ipIsBlocked(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
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
  // URL.hostname keeps the brackets around an IPv6 literal — strip them so the
  // address itself is what gets checked.
  const host = url.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");
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
