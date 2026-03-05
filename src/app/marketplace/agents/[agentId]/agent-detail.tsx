"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { use } from "react";
import Link from "next/link";

export default function AgentDetail({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = use(params);
  const agent = useQuery(api.agents.getById, {
    agentId: agentId as Id<"agents">,
  });
  const services = useQuery(api.services.listByAgent, {
    agentId: agentId as Id<"agents">,
  });
  const reviews = useQuery(api.reviews.listByReviewee, {
    agentId: agentId as Id<"agents">,
  });

  if (!agent) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <Link
        href="/marketplace/agents"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
      >
        &larr; Back to agents
      </Link>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{agent.name}</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                agent.providerType === "agent"
                  ? "bg-blue-500/10 text-blue-400"
                  : agent.providerType === "saas"
                    ? "bg-purple-500/10 text-purple-400"
                    : "bg-primary/10 text-primary"
              }`}
            >
              {agent.providerType}
            </span>
          </div>
          <div className="text-right">
            {agent.totalReviews > 0 ? (
              <div className="text-yellow-400 text-lg font-bold">
                {agent.averageRating.toFixed(1)}
                <span className="text-xs text-muted-foreground ml-1">
                  / 5 ({agent.totalReviews} reviews)
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground/60">No reviews yet</span>
            )}
          </div>
        </div>

        <p className="text-muted-foreground mb-4">{agent.description}</p>

        <div className="flex flex-wrap gap-1 mb-4">
          {agent.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground/60">Completed</p>
            <p className="text-foreground font-mono">
              {agent.totalJobsCompleted}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground/60">Failed</p>
            <p className="text-foreground font-mono">{agent.totalJobsFailed}</p>
          </div>
          <div>
            <p className="text-muted-foreground/60">Total Earned</p>
            <p className="text-primary font-mono">
              ${(agent.totalEarned / 100).toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground/60">Total Spent</p>
            <p className="text-foreground font-mono">
              ${(agent.totalSpent / 100).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground/60">
          <p>Wallet: {agent.walletAddress}</p>
          <p>Chain: {agent.chain}</p>
          {agent.agentUrl && <p>URL: {agent.agentUrl}</p>}
        </div>
      </div>

      {/* Services */}
      <h3 className="text-lg font-semibold text-foreground mb-4">Services</h3>
      {services && services.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {services.map((service) => (
            <div
              key={service._id}
              className="bg-card border border-border rounded-xl p-5"
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-medium text-foreground">{service.name}</h4>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    service.serviceType === "api"
                      ? "bg-primary/10 text-primary"
                      : "bg-blue-500/10 text-blue-400"
                  }`}
                >
                  {service.serviceType}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {service.description}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                <span className="font-mono text-primary">
                  ${(service.priceInCents / 100).toFixed(2)}
                </span>
                <span>{service.pricingModel.replace("_", "/")}</span>
                <span className="bg-secondary px-1.5 py-0.5 rounded">
                  {service.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60 mb-8">No services listed</p>
      )}

      {/* Reviews */}
      <h3 className="text-lg font-semibold text-foreground mb-4">Reviews</h3>
      {reviews && reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div
              key={review._id}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-yellow-400 font-mono text-sm">
                  {"*".repeat(review.rating)}
                  {"_".repeat(5 - review.rating)}
                </span>
                <span className="text-xs text-muted-foreground/60">
                  {review.rating}/5
                </span>
              </div>
              {review.comment && (
                <p className="text-sm text-muted-foreground">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60">No reviews yet</p>
      )}
    </div>
  );
}
