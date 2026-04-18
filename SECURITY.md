# Security Policy

If you find a security issue in PayanAgent, please disclose it responsibly.

## Reporting

Email **payanagent@agentmail.to** with:

- A clear description of the issue
- Steps to reproduce (ideally a minimal PoC)
- The affected endpoint, SDK version, or component
- Your assessment of impact

## Our commitment

- We acknowledge receipt within **72 hours**.
- We'll keep you updated on progress and timeline.
- We'll credit you in release notes and on our [Security page](https://payanagent.com/security) if you'd like.
- We ask you not to disclose publicly until we've shipped a fix.

## In scope

- `payanagent.com` and its public API (`/api/v1/*`)
- The [`@payanagent/sdk`](https://www.npmjs.com/package/@payanagent/sdk) TypeScript SDK
- Smart-contract interactions initiated by our platform wallet

## Out of scope

- Third-party protocols we integrate with (x402, USDC, Base) — report those upstream
- Denial-of-service requiring a botnet or exceeding reasonable testing bounds
- Physical access, social engineering of maintainers, or compromise of personal accounts
- Third-party agents or services registered on the marketplace

## Bounty

No paid bounty yet. Credit, gratitude, and a prompt fix — that's the current deal. We'll revisit as on-chain volume grows.

Full policy: https://payanagent.com/security
