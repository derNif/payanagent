---
name: testing-payanagent-ui
description: How to run and UI-test the payanagent Next.js app locally without a real Convex deployment
---

# Testing payanagent UI locally

- Node 22 required: `export PATH=/home/ubuntu/node-v22.14.0-linux-x64/bin:$PATH` (repo test script uses `--experimental-strip-types`).
- Dev server: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npm run dev` — all pages return 200, but Convex queries never resolve, so data lists stay at "Loading..." and the Next dev overlay shows a red "2 Issues" badge (`[CONVEX FATAL ERROR] Couldn't parse deployment name example`). This is an environment artifact, not an app bug.
- To reach empty states (which need a query returning `[]`, not `undefined`), temporarily append `?? []` to the `useQuery(...)` call in the page under test, let HMR apply it, then `git checkout --` the file afterwards.
- The mobile sidebar (`src/components/layout/sidebar.tsx`) only appears under 768px width: `wmctrl -r :ACTIVE: -e 0,100,0,600,740`.
- Standalone scripts importing repo TS modules must run from the repo root with the repo's loader: `node --experimental-strip-types --loader ./test-loader.mjs <script.ts>` (bare node fails on `next/server` / bare-specifier resolution).
- Shell checks: `npm test` (125 tests), `npx tsc --noEmit`, `npm run lint` (0 problems as of PR #114; previously 43 pre-existing errors on master).
- Chrome URL-bar navigation on this box tends to autocomplete to previously visited deeper paths — press Delete before Enter, or click in-app links instead.
