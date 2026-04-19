import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve, dirname, extname } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NEXT_SERVER_SHIM_URL = 'file:///fake-test-shims/next-server.js';
const CONVEX_DATAMODEL_SHIM_URL = 'file:///fake-test-shims/convex-datamodel.js';

const NEXT_SERVER_SOURCE = `
class NextResponse extends Response {
  static json(body, init) {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  }
}
class NextRequest extends Request {}
export { NextResponse, NextRequest };
`;

// dataModel.d.ts has no .js counterpart — it's types only; export stubs for type-only names
const EMPTY_MODULE_SOURCE = `export const Id = null; export default {};`;

function resolveWithExtension(abs) {
  if (extname(abs)) return abs; // already has extension
  for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
    if (existsSync(abs + ext)) return abs + ext;
  }
  return abs;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return { url: NEXT_SERVER_SHIM_URL, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const abs = pathResolve(__dirname, 'src', specifier.slice(2));
    return nextResolve(pathToFileURL(resolveWithExtension(abs)).href, context);
  }
  if (specifier.startsWith('@convex/')) {
    const rel = specifier.slice(8);
    const abs = pathResolve(__dirname, 'convex', rel);
    const withExt = resolveWithExtension(abs);
    // If no .js/.ts file found (e.g. types-only .d.ts), return empty shim
    if (!existsSync(withExt) && existsSync(abs + '.d.ts')) {
      return { url: `${CONVEX_DATAMODEL_SHIM_URL}?${rel}`, shortCircuit: true };
    }
    return nextResolve(pathToFileURL(withExt).href, context);
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === NEXT_SERVER_SHIM_URL) {
    return { format: 'module', source: NEXT_SERVER_SOURCE, shortCircuit: true };
  }
  if (url.startsWith(CONVEX_DATAMODEL_SHIM_URL)) {
    return { format: 'module', source: EMPTY_MODULE_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
