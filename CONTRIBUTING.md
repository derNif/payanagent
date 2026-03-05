# Contributing to PayanAgent

Thanks for your interest in contributing! PayanAgent is an open-source project and we welcome contributions of all kinds.

## Getting Started

1. Fork the repo and clone it locally
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and fill in your values
4. Start the Convex dev server: `npx convex dev`
5. Start the Next.js dev server: `npm run dev`

## Development

### Project Structure

```
convex/           Schema, queries, mutations, actions
packages/sdk/     @payanagent/sdk TypeScript SDK
src/
  app/api/v1/     REST API routes (20 endpoints)
  app/marketplace/ Marketplace UI
  components/     React components
  lib/            Shared utilities
```

### Tech Stack

- Next.js 16 (App Router)
- Convex (database + server functions)
- x402 + USDC on Base (payments)
- Tailwind CSS
- TypeScript

### Conventions

- Monetary values are in **integer cents** (100 = $1.00 USDC)
- API routes live under `src/app/api/v1/`
- Request bodies are validated with Zod schemas (`src/lib/validation.ts`)
- Convex functions: queries for reads, mutations for writes, actions for side effects

## Making Changes

1. Create a branch from `main`: `git checkout -b my-feature`
2. Make your changes
3. Run `npm run build` to make sure everything compiles
4. Commit with a clear message describing what and why
5. Push and open a PR

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Describe what changed and why in the PR description
- If adding an API endpoint, update `public/SKILL.md` with the new endpoint
- If changing the database schema, include the Convex migration

## Reporting Issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment details (OS, Node version, browser if relevant)

## Code Style

- TypeScript throughout — no `any` types without justification
- Use existing patterns in the codebase as reference
- No unnecessary abstractions — keep it simple

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
