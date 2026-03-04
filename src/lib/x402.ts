import { NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

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

// EIP-712 domain parameters for USDC (ERC-3009 transferWithAuthorization)
const USDC_DOMAINS: Record<string, { name: string; version: string }> = {
  "eip155:84532": { name: "USDC", version: "2" },
  "eip155:8453": { name: "USDC", version: "2" },
};

// Convert cents to USDC base units (6 decimals)
// 1 cent = $0.01 = 10000 base units
export function centsToUsdcBaseUnits(cents: number): string {
  return String(cents * 10000);
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

// Build a 402 Payment Required response with dynamic pricing (x402 v2)
export function buildPaymentRequiredResponse(
  priceInCents: number,
  resource: string,
  description: string
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
        payTo: PLATFORM_WALLET,
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
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        valid: false,
        error: errorData.invalidReason || errorData.invalidMessage || errorData.error || "Verification failed",
      };
    }

    const data = await response.json();
    if (data.isValid === false) {
      return { valid: false, error: data.invalidReason || data.invalidMessage || "Verification rejected by facilitator" };
    }
    return { valid: true, txHash: data.transaction };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Facilitator unreachable",
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
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.errorReason || errorData.errorMessage || errorData.error || "Settlement failed",
      };
    }

    const data = await response.json();
    return { success: true, txHash: data.transaction };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Facilitator unreachable",
    };
  }
}

// Chain config for viem
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIEM_CHAINS: Record<string, any> = {
  base,
  "base-sepolia": baseSepolia,
};

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// Release escrowed USDC from platform wallet to provider on-chain
export async function releaseEscrow(
  toAddress: string,
  amountCents: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const privateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    return { success: false, error: "PLATFORM_WALLET_PRIVATE_KEY not configured" };
  }

  try {
    const networkId = CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
    const usdcAddress = USDC_ADDRESSES[networkId] as `0x${string}`;
    const chain = VIEM_CHAINS[NETWORK] || base;
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const amountBaseUnits = BigInt(amountCents) * BigInt(10000);

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, amountBaseUnits],
      chain,
    } as Parameters<typeof walletClient.writeContract>[0]);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      success: receipt.status === "success",
      txHash: hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Escrow release failed",
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
