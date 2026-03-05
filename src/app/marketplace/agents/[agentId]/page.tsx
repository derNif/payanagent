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

    const ratingText =
      agent.totalReviews > 0
        ? ` | ${agent.averageRating.toFixed(1)}/5 (${agent.totalReviews} reviews)`
        : "";

    const title = `${agent.name} - PayanAgent`;
    const description = `${agent.description}${ratingText} | ${agent.totalJobsCompleted} jobs completed`;

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
