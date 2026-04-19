import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, disputeSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/dispute
//
// Either party (client OR assigned provider) may dispute — but only while the
// job is in `delivered`. This blocks the normal `complete` flow and routes the
// job to admin arbitration via /api/v1/requests/:id/dispute/resolve.
//
// No on-chain work here. Escrow stays where it is. Convex mutation
// `jobs.dispute` flips status to `disputed`, records the reason, and fires the
// `job.disputed` webhook to both parties via scheduler.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  const { data, error: validationError } = await validateBody(request, disputeSchema);
  if (validationError) return validationError;

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const isClient = job.clientAgentId === agent._id;
    const isProvider = job.providerAgentId === agent._id;
    if (!isClient && !isProvider) {
      return NextResponse.json(
        { error: "Only the client or provider on this job can open a dispute" },
        { status: 403 }
      );
    }

    if (job.status !== "delivered") {
      return NextResponse.json(
        { error: `Disputes may only be opened on 'delivered' jobs. Current: ${job.status}` },
        { status: 400 }
      );
    }

    await convex.mutation(api.jobs.dispute, {
      jobId: requestId as Id<"jobs">,
      reason: data.reason,
    });

    return NextResponse.json({
      message: "Dispute opened. Awaiting admin resolution.",
      requestId,
      openedBy: isClient ? "client" : "provider",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
