import type { x402Client } from "@x402/fetch";
import type { LocalAccount } from "viem";

export type PayanAgentBeforePaymentCreationHook = Parameters<
  x402Client["onBeforePaymentCreation"]
>[0];

export interface PayanAgentPaymentPolicyContext {
  /** Wallet address used for the PayanAgent purchase. */
  walletAddress: `0x${string}`;
  /**
   * Signer interface for binding policy evidence to the purchasing wallet.
   * The raw private key is never exposed to a policy module.
   */
  signer: LocalAccount;
  /**
   * Create a separate x402 transport without the protected policy attached.
   * Paid policy providers can use this to avoid recursive policy calls.
   */
  createUnguardedPaidFetch(): typeof fetch;
  /** Ordinary, non-paying fetch. */
  fetchImpl: typeof fetch;
  /** PayanAgent marketplace origin used by this MCP process. */
  payanAgentBaseUrl: string;
}

export type PayanAgentPaymentPolicyFactory = (
  context: PayanAgentPaymentPolicyContext,
) => PayanAgentBeforePaymentCreationHook | Promise<PayanAgentBeforePaymentCreationHook>;

type PaymentPolicyModule = {
  createPaymentPolicy?: PayanAgentPaymentPolicyFactory;
  default?: PayanAgentPaymentPolicyFactory;
};

export async function loadPaymentPolicy(
  moduleSpecifier: string,
  context: PayanAgentPaymentPolicyContext,
): Promise<PayanAgentBeforePaymentCreationHook> {
  if (!moduleSpecifier) {
    throw new Error("payment policy module specifier is empty");
  }
  let loaded: PaymentPolicyModule;
  try {
    loaded = (await import(moduleSpecifier)) as PaymentPolicyModule;
  } catch (error) {
    throw new Error(
      `could not load payment policy module ${JSON.stringify(moduleSpecifier)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const factory = loaded.createPaymentPolicy ?? loaded.default;
  if (typeof factory !== "function") {
    throw new Error(
      "payment policy module must export createPaymentPolicy(context) or a default factory",
    );
  }
  const policy = await factory(context);
  if (typeof policy !== "function") {
    throw new Error("payment policy factory must return an x402 before-payment hook");
  }
  return policy;
}

export interface ConfigurePaymentPolicyInput {
  client: x402Client;
  moduleSpecifier?: string;
  signer: LocalAccount;
  fetchImpl: typeof fetch;
  payanAgentBaseUrl: string;
  createUnguardedPaidFetch(): typeof fetch;
}

/**
 * Attach an operator-selected policy before wrapping the client with paid fetch.
 * Configuration is deliberately fail closed: a configured module that cannot be
 * loaded or initialized prevents the MCP process from starting.
 */
export async function configurePaymentPolicy({
  client,
  moduleSpecifier,
  signer,
  fetchImpl,
  payanAgentBaseUrl,
  createUnguardedPaidFetch,
}: ConfigurePaymentPolicyInput): Promise<void> {
  if (!moduleSpecifier) return;
  const hook = await loadPaymentPolicy(moduleSpecifier, {
    walletAddress: signer.address,
    signer,
    createUnguardedPaidFetch,
    fetchImpl,
    payanAgentBaseUrl,
  });
  client.onBeforePaymentCreation(hook);
}
