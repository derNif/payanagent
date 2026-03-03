import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { buildPaymentRequiredResponse, verifyPayment, settlePayment, getFacilitatorUrl, getNetwork, getNetworkId } from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests — List requests
export async function GET(request: NextRequest) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const convex = getConvexClient();
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const type = searchParams.get("type"); // "open" to see marketplace

  try {
    if (type === "open") {
      const jobs = await convex.query(api.jobs.listOpen, {});
      return NextResponse.json({ jobs });
    }

    const jobs = await convex.query(api.jobs.listAll, {
      status: status ?? undefined,
    });
    return NextResponse.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/requests — Create a request
// For direct hire: x402 payment required (escrow)
// For open jobs: no payment yet (payment on bid acceptance)
export async function POST(request: NextRequest) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { serviceId, providerAgentId, title, description, inputPayload, budgetMaxCents, jobType } = body;

    if (!title || !description) {
      return NextResponse.json(
        { error: "title and description are required" },
        { status: 400 }
      );
    }

    const type = jobType || (providerAgentId ? "direct" : "open");
    const convex = getConvexClient();

    // For direct hire, get price and require x402 payment
    if (type === "direct") {
      if (!serviceId && !providerAgentId) {
        return NextResponse.json(
          { error: "Direct jobs require serviceId or providerAgentId" },
          { status: 400 }
        );
      }

      // Look up price
      let priceCents: number;
      if (serviceId) {
        const service = await convex.query(api.services.getById, {
          serviceId: serviceId as Id<"services">,
        });
        if (!service) {
          return NextResponse.json({ error: "Service not found" }, { status: 404 });
        }
        priceCents = service.priceInCents;
      } else {
        priceCents = body.agreedPriceCents;
        if (!priceCents) {
          return NextResponse.json(
            { error: "agreedPriceCents required for direct hire without serviceId" },
            { status: 400 }
          );
        }
      }

      // Check for x402 payment
      const paymentSignature = request.headers.get("payment-signature") || request.headers.get("x-payment");

      if (!paymentSignature) {
        return buildPaymentRequiredResponse(
          priceCents,
          request.url,
          `Escrow payment for job: ${title}`
        );
      }

      // Verify and settle payment
      const paymentRequired = request.headers.get("payment-required") || "";
      const verification = await verifyPayment(paymentSignature, paymentRequired);

      if (!verification.valid) {
        return NextResponse.json(
          { error: `Payment verification failed: ${verification.error}` },
          { status: 402 }
        );
      }

      const settlement = await settlePayment(paymentSignature, paymentRequired);

      // Record escrow transaction
      const txId = await convex.mutation(api.transactions.create, {
        fromAgentId: agent._id,
        amountCents: priceCents,
        currency: "USDC",
        chain: getNetwork(),
        network: getNetworkId(),
        txHash: settlement.txHash,
        facilitatorUrl: getFacilitatorUrl(),
        type: "escrow_deposit",
        status: settlement.success ? "confirmed" : "pending",
        confirmedAt: settlement.success ? Date.now() : undefined,
      });

      // Create the job
      const jobId = await convex.mutation(api.jobs.create, {
        clientAgentId: agent._id,
        providerAgentId: providerAgentId as Id<"agents"> | undefined,
        serviceId: serviceId as Id<"services"> | undefined,
        title,
        description,
        inputPayload,
        agreedPriceCents: priceCents,
        jobType: "direct",
        escrowTransactionId: txId,
      });

      return NextResponse.json(
        {
          jobId,
          status: "open",
          agreedPriceCents: priceCents,
          escrowTransactionId: txId,
          message: `Job created. $${(priceCents / 100).toFixed(2)} USDC held in escrow.`,
        },
        { status: 201 }
      );
    }

    // Open job — no payment required yet
    if (!budgetMaxCents) {
      return NextResponse.json(
        { error: "Open jobs require budgetMaxCents" },
        { status: 400 }
      );
    }

    const jobId = await convex.mutation(api.jobs.create, {
      clientAgentId: agent._id,
      title,
      description,
      inputPayload,
      budgetMaxCents,
      jobType: "open",
    });

    return NextResponse.json(
      {
        jobId,
        status: "open",
        budgetMaxCents,
        message: "Open job created. Agents can now submit bids.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
