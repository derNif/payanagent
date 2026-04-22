import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const TWOCAPTCHA_API = "https://api.2captcha.com";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 24; // 2 min total

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recaptcha_v2"),
    sitekey: z.string().min(1),
    pageurl: z.string().url(),
    invisible: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("recaptcha_v3"),
    sitekey: z.string().min(1),
    pageurl: z.string().url(),
    action: z.string().optional(),
    min_score: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("hcaptcha"),
    sitekey: z.string().min(1),
    pageurl: z.string().url(),
  }),
  z.object({
    type: z.literal("image"),
    body: z.string().min(1), // base64-encoded image
  }),
]);

function buildTask(data: z.infer<typeof requestSchema>): Record<string, unknown> {
  switch (data.type) {
    case "recaptcha_v2":
      return {
        type: "RecaptchaV2TaskProxyless",
        websiteURL: data.pageurl,
        websiteKey: data.sitekey,
        isInvisible: data.invisible,
      };
    case "recaptcha_v3":
      return {
        type: "RecaptchaV3TaskProxyless",
        websiteURL: data.pageurl,
        websiteKey: data.sitekey,
        pageAction: data.action ?? "verify",
        minScore: data.min_score ?? 0.3,
      };
    case "hcaptcha":
      return {
        type: "HCaptchaTaskProxyless",
        websiteURL: data.pageurl,
        websiteKey: data.sitekey,
      };
    case "image":
      return {
        type: "ImageToTextTask",
        body: data.body,
      };
  }
}

// POST /api/v1/platform/2captcha
// Internal — called by the invoke route after x402 payment is settled.
// Clients interact through POST /api/v1/services/:serviceId/invoke.
export async function POST(request: NextRequest) {
  const internalKey = process.env.PLATFORM_INTERNAL_KEY;
  if (!internalKey || request.headers.get("x-platform-internal-key") !== internalKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "2captcha API key not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return NextResponse.json({ error: "Validation failed", details }, { status: 400 });
  }

  // Submit task
  let taskId: number;
  try {
    const createRes = await fetch(`${TWOCAPTCHA_API}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task: buildTask(parsed.data) }),
      signal: AbortSignal.timeout(30_000),
    });
    const createJson = (await createRes.json()) as { errorId: number; errorCode?: string; taskId?: number };
    if (createJson.errorId !== 0 || !createJson.taskId) {
      return NextResponse.json(
        { error: "2captcha task creation failed", code: createJson.errorCode },
        { status: 502 }
      );
    }
    taskId = createJson.taskId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream error";
    return NextResponse.json({ error: `2captcha request failed: ${msg}` }, { status: 502 });
  }

  // Poll for result
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let resultJson: {
      errorId: number;
      errorCode?: string;
      status?: string;
      solution?: Record<string, unknown>;
    };
    try {
      const resultRes = await fetch(`${TWOCAPTCHA_API}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
        signal: AbortSignal.timeout(15_000),
      });
      resultJson = await resultRes.json();
    } catch {
      continue; // transient error, retry
    }

    if (resultJson.errorId !== 0) {
      return NextResponse.json(
        { error: "2captcha task failed", code: resultJson.errorCode },
        { status: 502 }
      );
    }

    if (resultJson.status === "ready" && resultJson.solution) {
      const sol = resultJson.solution;
      // Normalise: return the most recognisable field for the captcha type
      const solution =
        typeof sol.gRecaptchaResponse === "string" ? sol.gRecaptchaResponse :
        typeof sol.text === "string" ? sol.text :
        typeof sol.token === "string" ? sol.token :
        sol;
      return NextResponse.json({ solution, task_id: taskId });
    }
    // status === "processing" — keep polling
  }

  return NextResponse.json({ error: "2captcha timed out waiting for solution" }, { status: 504 });
}
