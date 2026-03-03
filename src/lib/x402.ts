import { NextResponse } from "next/server";

const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
const NETWORK = process.env.X402_NETWORK || "base";

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

// Convert cents to USDC base units (6 decimals)
// 1 cent = $0.01 = 10000 base units
export function centsToUsdcBaseUnits(cents: number): string {
  return String(cents * 10000);
}

// Build a 402 Payment Required response with dynamic pricing
export function buildPaymentRequiredResponse(
  priceInCents: number,
  resource: string,
  description: string
) {
  const networkId = CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
  const asset = USDC_ADDRESSES[networkId];

  const paymentRequired = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: networkId,
        maxAmountRequired: centsToUsdcBaseUnits(priceInCents),
        resource,
        description,
        payTo: PLATFORM_WALLET,
        asset,
        maxTimeoutSeconds: 60,
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

// Verify a payment via the facilitator
export async function verifyPayment(paymentSignature: string, paymentRequired: string): Promise<{
  valid: boolean;
  txHash?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentSignature,
        paymentRequired,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { valid: false, error: errorData.error || "Verification failed" };
    }

    const data = await response.json();
    return { valid: true, txHash: data.txHash };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Facilitator unreachable",
    };
  }
}

// Settle a payment via the facilitator (submit the on-chain transaction)
export async function settlePayment(paymentSignature: string, paymentRequired: string): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentSignature,
        paymentRequired,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || "Settlement failed" };
    }

    const data = await response.json();
    return { success: true, txHash: data.txHash };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Facilitator unreachable",
    };
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
