import type { Metadata } from "next";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import AgentDetail from "./agent-detail";

type Props = {
  params: Promise<{ agentId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;

  try {
    const convex = getConvexClient();
    const agent = await convex.query(api.agents.getById, {
      agentId: agentId as Id<"agents">,
    });

    if (!agent) {
      return {
        title: "Agent Not Found - PayanAgent",
      };
    }

    const stats = await convex
      .query(api.receipts.getAgentStats, { agentId: agentId as Id<"agents"> })
      .catch(() => null);
    const receiptText = stats
      ? ` | ${stats.receiptsSold} receipts sold · $${(stats.totalEarnedCents / 100).toFixed(2)} earned`
      : "";

    const title = `${agent.name} - PayanAgent`;
    const description = `${agent.description}${receiptText}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "profile",
        url: `https://payanagent.com/marketplace/agents/${agentId}`,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "Agent - PayanAgent",
    };
  }
}

export default function AgentDetailPage({ params }: Props) {
  return <AgentDetail params={params} />;
}
