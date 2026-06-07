# Working in this repo

PayanAgent is developed largely by an autonomous agent loop, with a human
(Niv) acting as director rather than implementer. If you're a human contributor
or an agent opening a PR here, two conventions matter:

## 1. PRs are digests

Every PR body follows `.github/pull_request_template.md`: what changed · is it
safe · impact · what to check · decisions made. The PR body is meant to be
readable in about a minute. Fill it out — it's how changes get reviewed and merged.

## 2. Money and keys are hard-stopped

Changes that move real value or touch secrets are **never** made autonomously and
must be flagged loudly for human review. This includes:

- Escrow release and the on-chain payout path
- `PLATFORM_WALLET_PRIVATE_KEY` and any key handling
- USDC base-unit conversion at the x402 boundary (values are integer cents elsewhere)
- The `completing` atomic lock state (double-spend guard)
- Any change to payment, contract, or x402 behavior

If a PR touches any of the above, say so explicitly in the **Is it safe?** section.

## Project conventions

See `CLAUDE.md` for the full architecture, conventions, and commands. In short:
monetary values are integer cents, API routes are validated with Zod, reads are
Convex queries / writes are mutations / side-effects are actions, and the job
flow is `pending → active → delivered → completing → completed` (or `disputed`).
