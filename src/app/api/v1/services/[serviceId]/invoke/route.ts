import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { buildPaymentRequiredResponse, verifyPayment, verifyPaymentIntegrity, settlePayment, getFacilitatorUrl, getNetwork, getNetworkId } from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/services/:serviceId/invoke — Call a service (x402 direct pay)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { serviceId } = await params;
  const convex = getConvexClient();

  // Get service
  let service;
  try {
    service = await convex.query(api.services.getById, {
      serviceId: serviceId as Id<"services">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid service ID" }, { status: 400 });
  }

  if (!service || !service.isActive) {
    return NextResponse.json({ error: "Service not found or inactive" }, { status: 404 });
  }

  if (service.serviceType !== "api") {
    return NextResponse.json(
      { error: "This service is not an API service. Create a job instead." },
      { status: 400 }
    );
  }

  if (!service.endpoint) {
    return NextResponse.json(
      { error: "Service has no endpoint configured" },
      { status: 500 }
    );
  }

  // Check for x402 payment
  const paymentSignature = request.headers.get("payment-signature") || request.headers.get("x-payment");

  if (!paymentSignature) {
    // Return 402 with payment requirements
    return buildPaymentRequiredResponse(
      service.priceInCents,
      request.url,
      `Payment for service: ${service.name}`
    );
  }

  // Verify payment amount matches service price
  const integrityCheck = verifyPaymentIntegrity(paymentSignature, service.priceInCents);
  if (!integrityCheck.valid) {
    return NextResponse.json(
      { error: `Payment integrity check failed: ${integrityCheck.error}` },
      { status: 402 }
    );
  }

  // Verify and settle payment via facilitator
  const paymentRequired = request.headers.get("payment-required") || "";
  const verification = await verifyPayment(paymentSignature, paymentRequired);

  if (!verification.valid) {
    return NextResponse.json(
      { error: `Payment verification failed: ${verification.error}` },
      { status: 402 }
    );
  }

  const settlement = await settlePayment(paymentSignature, paymentRequired);

  if (!settlement.success) {
    return NextResponse.json(
      { error: `Payment settlement failed: ${settlement.error}` },
      { status: 402 }
    );
  }

  // Record the transaction (only reached on successful settlement)
  const txId = await convex.mutation(api.transactions.create, {
    fromAgentId: agent._id,
    toAgentId: service.agentId,
    amountCents: service.priceInCents,
    currency: "USDC",
    chain: getNetwork(),
    network: getNetworkId(),
    txHash: settlement.txHash,
    facilitatorUrl: getFacilitatorUrl(),
    type: "direct_payment",
    status: "confirmed",
    confirmedAt: Date.now(),
  });

  // Proxy the request to the service endpoint
  try {
    const body = await request.text();
    const proxyResponse = await fetch(service.endpoint, {
      method: service.httpMethod || "POST",
      headers: { "Content-Type": "application/json" },
      body: body || undefined,
    });

    const responseData = await proxyResponse.text();

    return new NextResponse(responseData, {
      status: proxyResponse.status,
      headers: {
        "Content-Type": proxyResponse.headers.get("Content-Type") || "application/json",
        "X-Transaction-Id": txId,
        "X-Tx-Hash": settlement.txHash || "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach service endpoint",
        transactionId: txId,
        message: "Payment was processed but the service call failed.",
      },
      { status: 502 }
    );
  }
}
