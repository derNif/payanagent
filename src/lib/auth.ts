import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "./convex";
import { api } from "@convex/_generated/api";

// Generate a new API key with prefix
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString("hex");
  const prefix_env = process.env.NODE_ENV === "production" ? "pk_live" : "pk_test";
  const key = `${prefix_env}_${random}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

// Hash an API key with SHA-256
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Authenticate a request and return the agent, or null
export async function authenticateRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);

  const convex = getConvexClient();

  const keyRecord = await convex.query(api.apiKeys.getByHash, { keyHash });
  if (!keyRecord || !keyRecord.isActive) {
    return null;
  }

  // Update last used (fire and forget)
  convex.mutation(api.apiKeys.updateLastUsed, { keyId: keyRecord._id });

  const agent = await convex.query(api.agents.getById, {
    agentId: keyRecord.agentId,
  });
  if (!agent || agent.status !== "active") {
    return null;
  }

  return agent;
}

// Helper to return 401 response
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Unauthorized. Provide a valid API key in Authorization: Bearer <key>" },
    { status: 401 }
  );
}
