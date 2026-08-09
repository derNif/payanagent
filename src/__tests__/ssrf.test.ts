import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

// DNS is stubbed so the guard is tested hermetically: `lookupResult` decides what
// every hostname resolves to.
let lookupResult: { address: string; family: number }[] = [];
mock.module("node:dns/promises", {
  namedExports: { lookup: async () => lookupResult },
});

async function load() {
  return import(rootUrl("src/lib/ssrf.ts"));
}

describe("assertPublicHttpUrl — malformed URLs and schemes", () => {
  it("rejects unparseable URLs", async () => {
    const { assertPublicHttpUrl } = await load();

    await assert.rejects(() => assertPublicHttpUrl("not a url"), /invalid URL/);
  });

  it("rejects non-http(s) schemes", async () => {
    const { assertPublicHttpUrl } = await load();

    for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com"]) {
      await assert.rejects(
        () => assertPublicHttpUrl(url),
        /URL scheme must be http or https/,
        url
      );
    }
  });
});

describe("assertPublicHttpUrl — hostnames blocked by name", () => {
  it("rejects loopback and cloud-metadata hostnames without resolving them", async () => {
    const { assertPublicHttpUrl } = await load();

    for (const host of [
      "localhost",
      "LOCALHOST",
      "api.localhost",
      "metadata.google.internal",
      "svc.internal",
    ]) {
      await assert.rejects(
        () => assertPublicHttpUrl(`http://${host}/x`),
        /URL host is not allowed/,
        host
      );
    }
  });
});

describe("assertPublicHttpUrl — IP literals", () => {
  it("rejects private, loopback, link-local, CGNAT and multicast IPv4", async () => {
    const { assertPublicHttpUrl } = await load();

    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254", // AWS/GCP metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      await assert.rejects(
        () => assertPublicHttpUrl(`https://${ip}/x`),
        /private or blocked address/,
        ip
      );
    }
  });

  it("allows public IPv4 literals just outside the blocked ranges", async () => {
    const { assertPublicHttpUrl } = await load();

    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.167.1.1", "100.63.0.1"]) {
      await assertPublicHttpUrl(`https://${ip}/x`);
    }
  });

  it("rejects loopback, link-local, unique-local and IPv4-mapped IPv6", async () => {
    const { assertPublicHttpUrl } = await load();

    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
      await assert.rejects(
        () => assertPublicHttpUrl(`https://[${ip}]/x`),
        /private or blocked address/,
        ip
      );
    }
  });

  it("allows public IPv6 literals", async () => {
    const { assertPublicHttpUrl } = await load();

    await assertPublicHttpUrl("https://[2606:4700::1111]/x");
    await assertPublicHttpUrl("https://[::ffff:8.8.8.8]/x");
  });
});

describe("assertPublicHttpUrl — DNS resolution", () => {
  it("allows a hostname that resolves to public addresses only", async () => {
    const { assertPublicHttpUrl } = await load();

    lookupResult = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ];
    await assertPublicHttpUrl("https://public.example.com/x");
  });

  it("rejects a public hostname that resolves to a private address (DNS rebinding)", async () => {
    const { assertPublicHttpUrl } = await load();

    lookupResult = [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await assert.rejects(
      () => assertPublicHttpUrl("https://sneaky.example.com/x"),
      /private or blocked address/
    );
  });

  it("rejects a hostname that resolves to nothing", async () => {
    const { assertPublicHttpUrl } = await load();

    lookupResult = [];
    await assert.rejects(
      () => assertPublicHttpUrl("https://nowhere.example.com/x"),
      /URL host did not resolve/
    );
  });
});
