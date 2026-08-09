import { NextResponse } from "next/server";
import { createPublicClient, getAddress, http, keccak256, parseAbi, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { errorMessage, logError } from "@/lib/errors";

const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";
const NETWORK = process.env.X402_NETWORK || "base";
// x402.org/facilitator is testnet only; xpay supports Base mainnet
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ||
  (NETWORK === "base-sepolia" ? "https://x402.org/facilitator" : "https://facilitator.xpay.sh");

// CAIP-2 chain IDs
const CHAIN_IDS: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

// USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// EIP-712 domain parameters for USDC (ERC-3009 transferWithAuthorization).
// These must match the token contract's name()/version() exactly or the
// on-chain signature check reverts: mainnet USDC is "USD Coin", testnet "USDC".
const USDC_DOMAINS: Record<string, { name: string; version: string }> = {
  "eip155:84532": { name: "USDC", version: "2" },
  "eip155:8453": { name: "USD Coin", version: "2" },
};

// Convert cents to USDC base units (6 decimals)
// 1 cent = $0.01 = 10000 base units
export function centsToUsdcBaseUnits(cents: number): string {
  return String(cents * 10000);
}

// Read a JSON body without letting a malformed one masquerade as an empty
// object — a facilitator reply we cannot parse is not a verdict.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(response: Response): Promise<any | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Decode a base64-encoded JSON header
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeBase64Header(header: string): any | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

// Extract the payer's wallet address from a signed x402 payment header.
// The EIP-3009 authorization carries `from` = the buyer; this is the identity
// for anonymous (keyless) x402 purchases. Returns null if it can't be read.
export function extractBuyerWallet(paymentSignatureHeader: string): string | null {
  const payload = decodeBase64Header(paymentSignatureHeader);
  const from = payload?.payload?.authorization?.from;
  return typeof from === "string" && /^0x[a-fA-F0-9]{40}$/.test(from) ? from : null;
}

// Build a 402 Payment Required response with dynamic pricing (x402 v2).
// payTo defaults to the platform wallet (escrow flows); direct buys pass the
// seller's wallet so settlement is trustless buyer->seller, no custody.
export function buildPaymentRequiredResponse(
  priceInCents: number,
  resource: string,
  description: string,
  payTo: string = PLATFORM_WALLET
) {
  const networkId = CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
  const asset = USDC_ADDRESSES[networkId];
  const domain = USDC_DOMAINS[networkId] || { name: "USDC", version: "2" };

  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: resource,
      description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: networkId,
        amount: centsToUsdcBaseUnits(priceInCents),
        payTo,
        asset,
        maxTimeoutSeconds: 60,
        extra: {
          name: domain.name,
          version: domain.version,
        },
      },
    ],
    error: "Payment required. Include PAYMENT-SIGNATURE header with signed USDC transfer.",
  };

  const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

  return new NextResponse(JSON.stringify({ error: "Payment required", priceUsd: priceInCents / 100 }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": encoded,
    },
  });
}

// Server-side verification that payment matches expected price and recipient
export function verifyPaymentIntegrity(
  paymentSignatureHeader: string,
  expectedAmountCents: number,
  expectedPayTo: string = PLATFORM_WALLET
): { valid: boolean; error?: string } {
  const payload = decodeBase64Header(paymentSignatureHeader);
  if (!payload) return { valid: false, error: "Cannot decode payment signature" };

  const accepted = payload.accepted;
  if (!accepted) return { valid: false, error: "Missing accepted requirements in payment" };

  // Fail closed: every binding field must be PRESENT and EQUAL. A missing field
  // is an attacker omitting it to skip the check — treat as invalid, not waived.

  // payTo = the expected recipient (seller for direct buys, platform for escrow)
  if (!accepted.payTo) {
    return { valid: false, error: "Payment is missing payTo" };
  }
  if (accepted.payTo.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return { valid: false, error: "Payment recipient does not match expected recipient" };
  }

  // amount = exact expected price in USDC base units
  const expectedBaseUnits = centsToUsdcBaseUnits(expectedAmountCents);
  if (accepted.amount === undefined || accepted.amount === null) {
    return { valid: false, error: "Payment is missing amount" };
  }
  if (String(accepted.amount) !== expectedBaseUnits) {
    return {
      valid: false,
      error: `Payment amount mismatch: expected ${expectedBaseUnits}, got ${accepted.amount}`,
    };
  }

  // network = the configured chain
  const expectedNetworkId = CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
  if (!accepted.network) {
    return { valid: false, error: "Payment is missing network" };
  }
  if (accepted.network !== expectedNetworkId) {
    return { valid: false, error: `Network mismatch: expected ${expectedNetworkId}, got ${accepted.network}` };
  }

  // asset = USDC on that chain. Without this, a payment denominated in any
  // token with matching numbers would pass; don't rely on facilitator policy.
  const expectedAsset = USDC_ADDRESSES[expectedNetworkId];
  if (!accepted.asset) {
    return { valid: false, error: "Payment is missing asset" };
  }
  if (
    !expectedAsset ||
    String(accepted.asset).toLowerCase() !== expectedAsset.toLowerCase()
  ) {
    return { valid: false, error: "Payment asset is not USDC on the expected network" };
  }

  return { valid: true };
}

// Verify a payment via the facilitator (x402 v2 structured format)
export async function verifyPayment(paymentSignatureHeader: string, paymentRequiredHeader: string): Promise<{
  valid: boolean;
  txHash?: string;
  error?: string;
}> {
  try {
    const paymentPayload = decodeBase64Header(paymentSignatureHeader);
    if (!paymentPayload) {
      return { valid: false, error: "Invalid payment signature header" };
    }

    // paymentRequirements = the requirement the client accepted (embedded in payload)
    const paymentRequirements = paymentPayload.accepted;
    if (!paymentRequirements) {
      return { valid: false, error: "Missing accepted payment requirements in payload" };
    }

    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version || 2,
        paymentPayload,
        paymentRequirements,
      }),
      // A hung facilitator must not hold the route open until the platform
      // times it out — fail the verify and let the buyer retry.
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorData = await readJson(response);
      const error =
        errorData?.invalidReason ||
        errorData?.invalidMessage ||
        errorData?.error ||
        `Verification failed (facilitator HTTP ${response.status})`;
      logError("x402:verify", error, {
        facilitator: FACILITATOR_URL,
        status: response.status,
      });
      return { valid: false, error };
    }

    const data = await readJson(response);
    if (!data) {
      logError("x402:verify", "facilitator returned an unparseable 2xx response", {
        facilitator: FACILITATOR_URL,
      });
      return { valid: false, error: "Facilitator returned an unparseable response" };
    }
    if (data.isValid === false) {
      return { valid: false, error: data.invalidReason || data.invalidMessage || "Verification rejected by facilitator" };
    }
    return { valid: true, txHash: data.transaction };
  } catch (error) {
    logError("x402:verify", error, { facilitator: FACILITATOR_URL });
    return {
      valid: false,
      error: errorMessage(error, "Facilitator unreachable"),
    };
  }
}

// Settle a payment via the facilitator (x402 v2 structured format)
export async function settlePayment(paymentSignatureHeader: string, paymentRequiredHeader: string): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
}> {
  try {
    const paymentPayload = decodeBase64Header(paymentSignatureHeader);
    if (!paymentPayload) {
      return { success: false, error: "Invalid payment signature header" };
    }

    const paymentRequirements = paymentPayload.accepted;
    if (!paymentRequirements) {
      return { success: false, error: "Missing accepted payment requirements in payload" };
    }

    const response = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version || 2,
        paymentPayload,
        paymentRequirements,
      }),
      // Longer than verify: settlement waits on an on-chain tx. On timeout the
      // outcome is UNKNOWN (the tx may still land) — settlePayment reports
      // failure and the caller must not retry blindly with real money; the
      // signed payload can only settle once at the facilitator either way.
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorData = await readJson(response);
      const error =
        errorData?.errorReason ||
        errorData?.errorMessage ||
        errorData?.error ||
        `Settlement failed (facilitator HTTP ${response.status})`;
      logError("x402:settle", error, {
        facilitator: FACILITATOR_URL,
        status: response.status,
      });
      return { success: false, error };
    }

    const data = await readJson(response);
    // Facilitators return HTTP 200 with { success: false } on settlement
    // failure — the status code alone is not a settlement guarantee. An
    // unreadable 200 is not one either: never report success we can't confirm.
    if (!data) {
      logError("x402:settle", "facilitator returned an unparseable 2xx response", {
        facilitator: FACILITATOR_URL,
      });
      return { success: false, error: "Facilitator returned an unparseable response" };
    }
    if (data.success === false || !data.transaction) {
      return {
        success: false,
        error: data.errorReason || data.errorMessage || "Settlement failed (no transaction)",
      };
    }
    return { success: true, txHash: data.transaction };
  } catch (error) {
    // The buyer may or may not have been charged — we cannot tell, so this has
    // to leave a trace even though the caller only sees "settlement failed".
    logError("x402:settle", error, { facilitator: FACILITATOR_URL });
    return {
      success: false,
      error: errorMessage(error, "Facilitator unreachable"),
    };
  }
}

// ERC-3009 nonce derived from a stable payout identity. Two signatures with
// the same nonce can never BOTH transfer: the token contract marks the nonce
// used on first execution and reverts the second. That makes a retry of the
// same payout replay-safe at the source of truth (the chain), even when the
// facilitator's answer to the first attempt was lost.
export function escrowAuthorizationNonce(idempotencyKey: string): `0x${string}` {
  return keccak256(toBytes(`payanagent:escrow:${idempotencyKey}`));
}

// EIP-712 typed-data shape for ERC-3009 transferWithAuthorization.
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const AUTHORIZATION_STATE_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

// Release escrowed USDC from the platform wallet to a recipient — GASLESS.
//
// The platform signs an ERC-3009 `transferWithAuthorization` and the facilitator
// submits it on-chain and pays the gas. This is the same rail escrow *deposits*
// already ride, just in reverse (platform -> recipient), so the platform wallet
// never needs an ETH balance. Previously this was a direct viem `transfer`,
// which meant every payout/refund was blocked unless the wallet held ETH.
//
// Used for all three escrow money paths: provider payout and surplus refund on
// approve, and buyer refund on cancel.
//
// `idempotencyKey` (stable per payout, e.g. `${requestId}:${settlementType}`)
// pins the authorization nonce, so a retry re-signs the SAME nonce and the
// token contract guarantees at most one of the attempts moves funds. When the
// nonce is found already used on-chain, `alreadyUsed: true` is returned so the
// caller keeps its receipt pending for reconciliation instead of retrying.
export async function releaseEscrow(
  toAddress: string,
  amountCents: number,
  idempotencyKey?: string,
): Promise<{ success: boolean; txHash?: string; error?: string; alreadyUsed?: boolean }> {
  const privateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    return { success: false, error: "PLATFORM_WALLET_PRIVATE_KEY not configured" };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    return { success: false, error: "Invalid private key format" };
  }
  // Fail closed on a malformed recipient or amount: this signs a real transfer.
  if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    return { success: false, error: "Invalid recipient address" };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { success: false, error: "Invalid release amount" };
  }

  try {
    const networkId = CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
    const asset = USDC_ADDRESSES[networkId];
    const domain = USDC_DOMAINS[networkId] || { name: "USDC", version: "2" };
    const chain = NETWORK === "base-sepolia" ? baseSepolia : base;

    const publicClient = createPublicClient({ chain, transport: http() });
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Payment terms for our own outbound payment: platform wallet -> recipient.
    const resource = {
      url: `${APP_URL}/escrow/release`,
      description: `Escrow release of ${amountCents} cents to ${toAddress}`,
      mimeType: "application/json",
    };
    const requirements = {
      scheme: "exact",
      network: networkId,
      amount: centsToUsdcBaseUnits(amountCents),
      payTo: toAddress,
      asset,
      maxTimeoutSeconds: 60,
      extra: { name: domain.name, version: domain.version },
    };

    let paymentPayload: unknown;

    if (idempotencyKey) {
      // Deterministic-nonce path: sign the ERC-3009 authorization directly so
      // the nonce is pinned to the payout identity. The chain enforces
      // single-use nonces, so no matter how many times this payout is retried
      // at most one authorization can ever transfer funds.
      const nonce = escrowAuthorizationNonce(idempotencyKey);

      // If a previous attempt's tx already landed (e.g. the facilitator call
      // timed out after submission), do NOT sign or submit anything.
      const used = await publicClient.readContract({
        address: getAddress(asset),
        abi: AUTHORIZATION_STATE_ABI,
        functionName: "authorizationState",
        args: [account.address, nonce],
      });
      if (used) {
        return {
          success: false,
          alreadyUsed: true,
          error: "authorization nonce already used on-chain (a previous attempt transferred)",
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const authorization = {
        from: account.address,
        to: getAddress(toAddress),
        value: requirements.amount,
        validAfter: String(now - 600),
        validBefore: String(now + requirements.maxTimeoutSeconds),
        nonce,
      };
      const signature = await account.signTypedData({
        domain: {
          name: domain.name,
          version: domain.version,
          chainId: chain.id,
          verifyingContract: getAddress(asset),
        },
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: authorization.from,
          to: authorization.to,
          value: BigInt(authorization.value),
          validAfter: BigInt(authorization.validAfter),
          validBefore: BigInt(authorization.validBefore),
          nonce,
        },
      });
      // Same shape x402Client.createPaymentPayload produces: `accepted` is what
      // settlePayment() forwards to the facilitator as the requirements.
      paymentPayload = {
        x402Version: 2,
        payload: { authorization, signature },
        resource,
        accepted: requirements,
      };
    } else {
      // Library path (random nonce) — kept for callers without a stable payout
      // identity. Lazy-loaded: keeps the signing stack out of every route's
      // cold start.
      const [{ x402Client }, { registerExactEvmScheme }, { toClientEvmSigner }] =
        await Promise.all([
          import("@x402/fetch"),
          import("@x402/evm/exact/client"),
          import("@x402/evm"),
        ]);
      const signer = toClientEvmSigner(account, publicClient);
      const client = new x402Client();
      registerExactEvmScheme(client, { signer });
      const paymentRequired = { x402Version: 2, resource, accepts: [requirements] };
      paymentPayload = await client.createPaymentPayload(
        paymentRequired as unknown as Parameters<typeof client.createPaymentPayload>[0],
      );
    }

    const signatureHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    return await settlePayment(signatureHeader, "");
  } catch (error) {
    logError("x402:release-escrow", error, { facilitator: FACILITATOR_URL });
    return {
      success: false,
      error: errorMessage(error, "Escrow release failed"),
    };
  }
}

// On-chain confirmation for a settlement tx hash. A facilitator's tx hash is a
// submission, not a guarantee — before a receipt flips pending → confirmed we
// check the chain itself. "unknown" (RPC down / not yet mined within the
// bound) is NOT a failure: the caller leaves the receipt pending and reconciles
// later instead of blocking the response.
export async function confirmTxOnChain(
  txHash: string,
  timeoutMs = 15_000,
): Promise<"confirmed" | "reverted" | "unknown"> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return "unknown";
  try {
    const publicClient = createPublicClient({
      chain: NETWORK === "base-sepolia" ? baseSepolia : base,
      transport: http(),
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: timeoutMs,
    });
    return receipt.status === "success" ? "confirmed" : "reverted";
  } catch (error) {
    logError("x402:confirm-tx", error, { txHash });
    return "unknown";
  }
}

export function getFacilitatorUrl() {
  return FACILITATOR_URL;
}

export function getNetwork() {
  return NETWORK;
}

export function getNetworkId() {
  return CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
}
