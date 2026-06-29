import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

// Public agent reads must not leak PII (ownerEmail) or operator-private growth
// attribution (discoverySource) — any exported query is reachable unauthenticated.
export type PublicAgent = Omit<Doc<"agents">, "ownerEmail" | "discoverySource">;
function publicAgent(a: Doc<"agents">): PublicAgent {
  const { ownerEmail, discoverySource, ...rest } = a;
  void ownerEmail;
  void discoverySource;
  return rest;
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    walletAddress: v.string(),
    chain: v.optional(v.string()),
    tags: v.array(v.string()),
    providerType: v.union(
      v.literal("agent"),
      v.literal("saas"),
      v.literal("api")
    ),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    discoverySource: v.optional(v.string()),
    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      description: args.description,
      walletAddress: args.walletAddress,
      chain: args.chain ?? "base",
      tags: args.tags,
      providerType: args.providerType,
      agentUrl: args.agentUrl,
      ownerEmail: args.ownerEmail,
      discoverySource: args.discoverySource,
      a2aCapabilities: args.a2aCapabilities,
      averageRating: 0,
      totalReviews: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      totalEarned: 0,
      totalSpent: 0,
      status: "active",
    });
    return agentId;
  },
});

export const getById = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<PublicAgent | null> => {
    const agent = await ctx.db.get(args.agentId);
    return agent ? publicAgent(agent) : null;
  },
});

// Return the agent for a wallet, creating a minimal auto-account if none exists.
// The wallet is the identity for anonymous x402 buyers — no registration needed.
// Convex mutations are serializable, so concurrent first-buys can't duplicate.
export const getOrCreateByWallet = mutation({
  args: { walletAddress: v.string(), chain: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"agents">> => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_walletAddress", (q) =>
        q.eq("walletAddress", args.walletAddress),
      )
      .first();
    if (existing) return existing._id;

    const short = `${args.walletAddress.slice(0, 6)}…${args.walletAddress.slice(-4)}`;
    return await ctx.db.insert("agents", {
      name: `agent-${short}`,
      description: "Wallet account (auto-created on first x402 payment).",
      walletAddress: args.walletAddress,
      chain: args.chain ?? "base",
      tags: [],
      providerType: "agent",
      status: "active",
      autoCreated: true,
      averageRating: 0,
      totalReviews: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      totalEarned: 0,
      totalSpent: 0,
    });
  },
});

export const getByWallet = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args): Promise<PublicAgent | null> => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_walletAddress", (q) =>
        q.eq("walletAddress", args.walletAddress)
      )
      .first();
    return agent ? publicAgent(agent) : null;
  },
});

export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("suspended"),
        v.literal("deactivated")
      )
    ),
  },
  handler: async (ctx, args): Promise<PublicAgent[]> => {
    // Defensive cap so this can't become the next services.listByAgent.
    const LIMIT = 500;
    const rows = args.status
      ? await ctx.db
          .query("agents")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .take(LIMIT)
      : await ctx.db.query("agents").take(LIMIT);
    return rows.map(publicAgent);
  },
});

// Full agent rows incl. ownerEmail/discoverySource — platform-secret gated, for
// the operator admin view only. Never exposed to public callers.
export const listAdmin = query({
  args: { platformSecret: v.string() },
  handler: async (ctx, args): Promise<Doc<"agents">[]> => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }
    return await ctx.db.query("agents").take(500);
  },
});

// Deactivate the handful of internal dev/test agents accumulated over building,
// so the overview's active count reflects real participants. Conservative name
// allowlist — never touches organic agents. Gated. One-time.
export const deactivateTestAgents = mutation({
  args: { platformSecret: v.string() },
  handler: async (ctx, args) => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }
    // Specific internal names only — never broad words like "audit" that would
    // catch organic agents (e.g. "Codex Audit Agent").
    const PATTERNS = [
      "test seller agent",
      "labs buy tester",
      "labs smoke tester",
      "smoke tester",
      "sepolia settlement",
      "audit agent a",
      "audit agent b",
      "linus audit",
    ];
    const all = await ctx.db.query("agents").take(2000);
    let deactivated = 0;
    const names: string[] = [];
    for (const a of all) {
      const n = a.name.toLowerCase();
      if (a.status !== "deactivated" && PATTERNS.some((p) => n.includes(p))) {
        await ctx.db.patch(a._id, { status: "deactivated" as const });
        deactivated++;
        names.push(a.name);
      }
    }
    return { deactivated, names };
  },
});

// Reactivate an agent by exact name (repair a wrong deactivation). Gated.
export const reactivateByName = mutation({
  args: { platformSecret: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }
    const all = await ctx.db.query("agents").take(2000);
    let reactivated = 0;
    for (const a of all) {
      if (a.name === args.name && a.status === "deactivated") {
        await ctx.db.patch(a._id, { status: "active" as const });
        reactivated++;
      }
    }
    return { reactivated };
  },
});

export const update = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { agentId, ...updates } = args;
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Agent not found");

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(agentId, filteredUpdates);
  },
});

export const deactivate = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch(args.agentId, { status: "deactivated" });
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    // Index-only counts via `.take()` ceiling — cheap if there are few agents,
    // bounded if there are many. Worst-case I/O = 1500 row reads instead of
    // the entire table.
    const LIMIT = 500;
    const allAgents = await ctx.db.query("agents").take(LIMIT);
    const active = allAgents.filter((a) => a.status === "active").length;
    return {
      total: allAgents.length,
      active,
      suspended: allAgents.filter((a) => a.status === "suspended").length,
    };
  },
});
