/**
 * Omniclaws - Global Edge AI Monetization Platform
 * Main Worker entry: routes requests, handles cron, <50ms target latency
 */

import { routeAndCharge, createBillingCustomer } from "./billing/router";
import { flushCharges, forceFlushCharges } from "./billing/usage-meter";
import {
  createCheckoutSession,
  createCreditPackCheckoutSession,
  handleCheckoutWebhook,
} from "./billing/stripe-checkout";
import { enforceDataResidency, validateDataResidency, EU_EEA_COUNTRIES } from "./compliance/gdpr";
import { logToR2 } from "./compliance/audit-logger";
import {
  handleOpenClawExecute,
  handleOpenClawExecuteUnified,
  handleOpenClawFreeExecute,
  handleOpenClawProExecute,
  getOpenClawTaskStatus,
  executeOpenClawTask,
  calculateTaskPrice,
  checkFreeTierLimit,
} from "./services/openclaw-api";
import { CREDIT_PACKS, addCredits, getCreditBalance } from "./billing/credit-wallet";
import {
  handleQEmploisMatch,
  getQEmploisStatus,
  processHumanReviewQueue,
  executeQEmploisTask,
} from "./services/q-emplois";
import {
  executeZyeuteContentTask,
  scrapeAndMonetize,
  getEarnings,
  processUnscrapedSources,
  autoPublish,
} from "./services/zyeute-content";
import {
  createSubscription,
  getWhaleAlerts,
} from "./services/whale-watcher";
import {
  generateReferralCode,
  getReferralStats,
  getReferralBalance,
  withdrawReferralBalance,
} from "./referrals/referral-system";
import { runWhaleScan } from "./cron/whale-scanner";
import { agentPoll, agentComplete, agentRegister, agentSubmitTask } from "./agent/local-agent";
import { checkCircuitBreaker, recordCircuitBreakerOutcome } from "./utils/failover";
import { checkRateLimit, pruneRateLimitTable } from "./utils/rate-limit";
import { getDashboardMetrics, getRealtimeStream, deepHealthCheck } from "./admin/dashboard";
import { runHealthCheckAndAlert } from "./monitoring/alerter";
import { getTenant, tenantAllowsFeature } from "./middleware/tenant";
import { serveLanding } from "./routes/landing";
import { serveCreditsPage } from "./routes/credits-page";
import { getAnalytics } from "./analytics/posthog";
import { getEmailService } from "./email/resend";
import type { Env, TaskRequest, TaskResult } from "./types";

const ADMIN_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function requireAdminAuth(request: Request, env: Env): Response | null {
  const auth = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!env.ADMIN_API_KEY || auth !== env.ADMIN_API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...ADMIN_CORS_HEADERS },
    });
  }
  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Resolve tenant by host (multi-tenant)
    const tenant = await getTenant(request, env.DB);
    env.TENANT = tenant;

    // Landing page (GET /)
    if (url.pathname === "/" && request.method === "GET") {
      const ref =
        url.searchParams.get("ref") ??
        (await import("./marketing/attribution")).synthesizeRefFromUtm(url);
      const utmSource = url.searchParams.get("utm_source");
      const utm =
        utmSource && ref
          ? {
              source: utmSource,
              medium: url.searchParams.get("utm_medium"),
              campaign: url.searchParams.get("utm_campaign"),
            }
          : undefined;
      if (ref) {
        ctx.waitUntil(
          import("./marketing/attribution").then(({ trackClick }) =>
            trackClick(ref, request, env.DB, undefined, utm)
          )
        );
      }
      return serveLanding(tenant, url.origin, ref, env);
    }

    // Health check - cache for 60s
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    // Task execution API
    if (url.pathname === "/api/task" && request.method === "POST") {
      return handleTaskRequest(request, env, ctx);
    }

    // OpenClaw estimate (cost before confirming)
    if (url.pathname === "/openclaw/estimate" && request.method === "POST") {
      if (!tenantAllowsFeature(tenant, "openclaw")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleOpenClawEstimateRoute(request, env);
    }

    // OpenClaw execute (unified: free 50/day or 1 credit for ai/priority)
    if (url.pathname === "/openclaw/execute" && request.method === "POST") {
      if (!tenantAllowsFeature(tenant, "openclaw")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleOpenClawExecuteUnifiedRoute(request, env, ctx);
    }

    // OpenClaw FREE (50/day, legacy)
    if (url.pathname === "/openclaw/free/execute" && request.method === "POST") {
      return handleOpenClawFreeExecuteRoute(request, env, ctx);
    }

    // OpenClaw PRO ($1.00 unlimited)
    if (url.pathname === "/openclaw/pro/execute" && request.method === "POST") {
      return handleOpenClawProExecuteRoute(request, env, ctx);
    }

    // OpenClaw free tier usage + credits (check remaining)
    if (url.pathname === "/openclaw/free/usage" && request.method === "GET") {
      if (!tenantAllowsFeature(tenant, "openclaw")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleOpenClawFreeUsageRoute(request, env);
    }
    if (url.pathname === "/openclaw/credits" && request.method === "GET") {
      if (!tenantAllowsFeature(tenant, "openclaw")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleOpenClawCreditsRoute(request, env);
    }

    // Credit pack purchase (Stripe Checkout)
    if (url.pathname === "/billing/purchase-credits" && request.method === "POST") {
      if (!tenantAllowsFeature(tenant, "openclaw")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handlePurchaseCreditsRoute(request, env);
    }

    // OpenClaw task status
    const statusMatch = url.pathname.match(/^\/openclaw\/status\/([^/]+)$/);
    if (statusMatch && request.method === "GET") {
      return handleOpenClawStatusRoute(statusMatch[1], env);
    }

    // Q-Emplois match (EU AI Act compliant recruitment AI)
    if (url.pathname === "/q-emplois/match" && request.method === "POST") {
      return handleQEmploisMatchRoute(request, env, ctx);
    }

    // Q-Emplois task status
    const qEmploisStatusMatch = url.pathname.match(/^\/q-emplois\/status\/([^/]+)$/);
    if (qEmploisStatusMatch && request.method === "GET") {
      return handleQEmploisStatusRoute(qEmploisStatusMatch[1], env);
    }

    // Zyeuté scrape (admin only, requires ZYEUTE_API_KEY)
    if (url.pathname === "/zyeute/scrape" && request.method === "POST") {
      return handleZyeuteScrapeRoute(request, env);
    }

    // Zyeuté earnings
    if (url.pathname === "/zyeute/earnings" && request.method === "GET") {
      return handleZyeuteEarningsRoute(env);
    }

    // WhaleWatcher subscribe (auth required)
    if (url.pathname === "/whales/subscribe" && request.method === "POST") {
      if (!tenantAllowsFeature(tenant, "whale")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleWhaleSubscribeRoute(request, env);
    }

    // WhaleWatcher alerts (historical)
    if (url.pathname === "/whales/alerts" && request.method === "GET") {
      if (!tenantAllowsFeature(tenant, "whale")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleWhaleAlertsRoute(request, env);
    }

    // Referral system
    if (url.pathname === "/referrals/create" && request.method === "POST") {
      if (!tenantAllowsFeature(tenant, "referral")) {
        return jsonResponse({ error: "Feature not available for this tenant" }, 403);
      }
      return handleReferralCreateRoute(request, env);
    }
    if (url.pathname === "/referrals/stats" && request.method === "GET") {
      return handleReferralStatsRoute(request, env);
    }
    if (url.pathname === "/referrals/balance" && request.method === "GET") {
      return handleReferralBalanceRoute(request, env);
    }
    if (url.pathname === "/referrals/withdraw" && request.method === "POST") {
      return handleReferralWithdrawRoute(request, env);
    }

    // Admin metrics (protected)
    if (url.pathname === "/admin/metrics" && request.method === "GET") {
      return handleAdminMetricsRoute(request, env);
    }

    // Admin health (protected)
    if (url.pathname === "/admin/health" && request.method === "GET") {
      return handleAdminHealthRoute(request, env);
    }

    // Admin realtime stream (protected)
    if (url.pathname === "/admin/realtime" && request.method === "GET") {
      return handleAdminRealtimeRoute(request, env);
    }

    // Admin add credits (for testing without Stripe)
    if (url.pathname === "/admin/add-credits" && request.method === "POST") {
      return handleAdminAddCreditsRoute(request, env);
    }

    // Admin attribution dashboard
    if (url.pathname === "/admin/attribution" && request.method === "GET") {
      return handleAdminAttributionRoute(request, env);
    }
    if (url.pathname === "/admin/attribution/create" && request.method === "POST") {
      return handleAdminAttributionCreateRoute(request, env);
    }

    // Admin content calendar
    if (url.pathname === "/admin/content-calendar" && request.method === "GET") {
      return handleAdminContentCalendarRoute(request, env);
    }
    if (url.pathname === "/admin/content-calendar" && request.method === "POST") {
      return handleAdminContentCalendarCreateRoute(request, env);
    }
    const contentCalendarPutMatch = url.pathname.match(/^\/admin\/content-calendar\/([^/]+)\/posted$/);
    if (contentCalendarPutMatch && request.method === "PUT") {
      return handleAdminContentCalendarMarkPostedRoute(contentCalendarPutMatch[1], request, env);
    }

    // Billing debug: create customer (no auth - called before first charge)
    if (url.pathname === "/billing/create-customer" && request.method === "POST") {
      return handleBillingCreateCustomerRoute(request, env);
    }

    // Admin billing debug
    if (url.pathname === "/admin/billing-status" && request.method === "GET") {
      return handleAdminBillingStatusRoute(request, env);
    }

    // Admin: Test email flows
    if (url.pathname === "/admin/test-email" && request.method === "POST") {
      return handleTestEmailRoute(request, env);
    }
    if (url.pathname === "/billing/flush" && request.method === "POST") {
      return handleBillingFlushRoute(request, env);
    }

    // Stripe Checkout - get hosted payment URL
    if (url.pathname === "/billing/checkout" && request.method === "GET") {
      return handleBillingCheckoutRoute(request, env);
    }

    // Stripe webhook (validates signature, no auth)
    if (url.pathname === "/billing/webhook" && request.method === "POST") {
      return handleStripeWebhookRoute(request, env);
    }

    // Local Agent mode (Ollama distributed mesh)
    if (url.pathname === "/agent/poll" && request.method === "GET") {
      return handleAgentPollRoute(request, env);
    }
    if (url.pathname === "/agent/complete" && request.method === "POST") {
      return handleAgentCompleteRoute(request, env);
    }
    if (url.pathname === "/agent/register" && request.method === "POST") {
      return handleAgentRegisterRoute(request, env);
    }
    if (url.pathname === "/agent/submit" && request.method === "POST") {
      return handleAgentSubmitRoute(request, env);
    }

    // Checkout success/cancel pages (redirect targets)
    if (url.pathname === "/billing/success" && request.method === "GET") {
      const { serveBillingSuccess } = await import("./routes/billing-success");
      return serveBillingSuccess(request, env);
    }
    if (url.pathname === "/billing/cancel" && request.method === "GET") {
      return new Response("Payment cancelled.", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/admin/")) {
      return new Response(null, { status: 204, headers: ADMIN_CORS_HEADERS });
    }

    // Billing webhook (idempotent)
    if (url.pathname === "/api/billing/webhook") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reprocessFailedTasks(env));
    ctx.waitUntil(processHumanReviewQueue(env.DB, env.AUDIT_BUCKET, env));
    ctx.waitUntil(processUnscrapedSources(env.DB));
    ctx.waitUntil(runHealthCheckAndAlert(env.DB, env));
    ctx.waitUntil(runWhaleScan(env.DB, env));
    ctx.waitUntil(pruneRateLimitTable(env.DB));
  },
};

async function handleOpenClawEstimateRoute(request: Request, env: Env): Promise<Response> {
  let body: { payload?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { priceCents, tier } = calculateTaskPrice(body.payload ?? {}, env);
  return jsonResponse({
    priceCents,
    priceUsd: (priceCents / 100).toFixed(2),
    tier,
    message: `This task will cost $${(priceCents / 100).toFixed(2)} (${tier} complexity)`,
  });
}

async function handleOpenClawExecuteRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const circuit = await checkCircuitBreaker(env.DB);
  if (circuit.open) {
    return jsonResponse({ error: circuit.message ?? "Service temporarily unavailable" }, 503);
  }

  const url = new URL(request.url);
  const refFromUrl = url.searchParams.get("ref") ?? undefined;

  let body: { userId: string; taskType?: string; payload?: Record<string, unknown>; ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, true));
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.userId) {
    ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, true));
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const ref = body.ref ?? refFromUrl;

  const result = await handleOpenClawExecute(
    { userId: body.userId, taskType: body.taskType, payload: body.payload, ref },
    env.DB,
    env
  );

  ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, !result.success));

  if (result.success) {
    ctx.waitUntil(
      flushCharges(env.DB, body.userId, env).then((r) => {
        if (r.chargeCount && r.chargeCount > 0) {
          console.log(`[flush] userId=${body.userId} charged ${r.amountCents} cents`);
        }
      })
    );
  }

  return jsonResponse(
    result.success
      ? { success: true, taskId: result.taskId, cost: result.cost, tier: result.tier }
      : { success: false, taskId: result.taskId, error: result.error },
    result.success ? 200 : 500
  );
}

async function handleOpenClawStatusRoute(taskId: string, env: Env): Promise<Response> {
  const status = await getOpenClawTaskStatus(taskId, env.DB);
  if (!status.found) {
    return jsonResponse({ error: "Task not found" }, 404);
  }
  return jsonResponse({
    taskId: status.taskId,
    status: status.status,
    createdAt: status.createdAt,
    completedAt: status.completedAt,
  });
}

async function handleOpenClawFreeExecuteRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const circuit = await checkCircuitBreaker(env.DB);
  if (circuit.open) {
    return jsonResponse({ error: circuit.message ?? "Service temporarily unavailable" }, 503);
  }

  let body: { userId: string; payload?: Record<string, unknown>; ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const result = await handleOpenClawFreeExecute(
    { userId: body.userId, payload: body.payload, ref: body.ref },
    env.DB
  );

  ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, !result.success));

  return jsonResponse(
    result.success
      ? {
          success: true,
          taskId: result.taskId,
          cost: 0,
          tier: "free",
          remainingToday: result.remainingToday,
        }
      : { success: false, taskId: result.taskId, error: result.error },
    result.success ? 200 : 500
  );
}

async function handleOpenClawProExecuteRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const circuit = await checkCircuitBreaker(env.DB);
  if (circuit.open) {
    return jsonResponse({ error: circuit.message ?? "Service temporarily unavailable" }, 503);
  }

  let body: { userId: string; payload?: Record<string, unknown>; ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const result = await handleOpenClawProExecute(
    { userId: body.userId, payload: body.payload, ref: body.ref },
    env.DB,
    env
  );

  ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, !result.success));

  if (result.success) {
    ctx.waitUntil(
      flushCharges(env.DB, body.userId, env).then((r) => {
        if (r.chargeCount && r.chargeCount > 0) {
          console.log(`[flush] pro userId=${body.userId} charged ${r.amountCents} cents`);
        }
      })
    );
  }

  return jsonResponse(
    result.success
      ? { success: true, taskId: result.taskId, cost: result.cost, tier: "pro" }
      : { success: false, taskId: result.taskId, error: result.error },
    result.success ? 200 : 500
  );
}

async function handleOpenClawFreeUsageRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return jsonResponse({ error: "Missing userId query param" }, 400);
  }

  const limit = await checkFreeTierLimit(userId, env.DB);
  return jsonResponse({
    used: limit.used,
    limit: limit.limit,
    remaining: limit.remaining,
    message:
      limit.remaining === 0
        ? limit.reason
        : `${limit.remaining ?? 0}/${limit.limit ?? 50} free tasks remaining today`,
  });
}

async function handleOpenClawCreditsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? request.headers.get("X-User-Id");
  if (!userId) {
    return jsonResponse({ error: "Missing userId (query param or X-User-Id header)" }, 400);
  }

  const balance = await getCreditBalance(userId, env.DB);
  const accept = request.headers.get("Accept") ?? "";

  if (accept.includes("text/html")) {
    return serveCreditsPage(balance, url.origin, userId, env);
  }

  return jsonResponse({
    credits: balance.creditBalance,
    freeTasksUsed: balance.freeTasksUsed,
    freeTasksRemaining: balance.freeTasksRemaining,
    freeTasksLimit: balance.freeTasksLimit,
    message: `Free: ${balance.freeTasksRemaining}/${balance.freeTasksLimit} today. Pro credits: ${balance.creditBalance}`,
  });
}

async function handleOpenClawExecuteUnifiedRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const circuit = await checkCircuitBreaker(env.DB);
  if (circuit.open) {
    return jsonResponse({ error: circuit.message ?? "Service temporarily unavailable" }, 503);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const rateLimit = await checkRateLimit(ip, "/openclaw/execute", env.DB);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: "Rate limit exceeded. Try again in a few seconds.",
        retryAfter: rateLimit.retryAfter,
      },
      429,
      rateLimit.retryAfter ? { "Retry-After": String(rateLimit.retryAfter) } : {}
    );
  }

  const url = new URL(request.url);
  const refFromUrl = url.searchParams.get("ref") ?? undefined;

  let body: { userId: string; payload?: Record<string, unknown>; ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const ref = body.ref ?? refFromUrl;
  if (ref) {
    const { trackClick, recordUserAttribution } = await import("./marketing/attribution");
    ctx.waitUntil(trackClick(ref, request, env.DB, body.userId));
    ctx.waitUntil(recordUserAttribution(body.userId, ref, env.DB));
  }

  const result = await handleOpenClawExecuteUnified(
    { userId: body.userId, payload: body.payload, ref },
    env.DB
  );

  ctx.waitUntil(recordCircuitBreakerOutcome(env.DB, !result.success));

  return jsonResponse(
    result.success
      ? {
          success: true,
          taskId: result.taskId,
          creditsRemaining: result.creditsRemaining,
          freeTasksRemaining: result.remainingToday,
          tier: result.tier,
        }
      : { success: false, taskId: result.taskId, error: result.error },
    result.success ? 200 : 500
  );
}

async function handlePurchaseCreditsRoute(request: Request, env: Env): Promise<Response> {
  let body: { userId: string; pack: "starter" | "pro" | "whale"; ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId || !body.pack) {
    return jsonResponse({ error: "Missing userId or pack (starter|pro|whale)" }, 400);
  }
  if (!(body.pack in CREDIT_PACKS)) {
    return jsonResponse({ error: "Invalid pack. Use starter, pro, or whale" }, 400);
  }

  const baseUrl = new URL(request.url).origin;
  const multiplier = env.TENANT?.pricing_multiplier ?? 1.0;
  const result = await createCreditPackCheckoutSession(
    body.userId,
    body.pack as keyof typeof CREDIT_PACKS,
    env.DB,
    env,
    baseUrl,
    multiplier,
    body.ref
  );

  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }

  return jsonResponse({
    checkoutUrl: result.checkoutUrl,
    sessionId: result.sessionId,
    pack: body.pack,
    credits: CREDIT_PACKS[body.pack as keyof typeof CREDIT_PACKS].credits,
  });
}

async function handleQEmploisMatchRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const countryCode = request.headers.get("cf-ipcountry") ?? "XX";

  if (EU_EEA_COUNTRIES.has(countryCode.toUpperCase())) {
    enforceDataResidency(countryCode);
  }

  let body: { userId: string; candidateData?: Record<string, unknown>; jobData?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const result = await handleQEmploisMatch(
    {
      userId: body.userId,
      candidateData: body.candidateData ?? {},
      jobData: body.jobData ?? {},
    },
    env.DB,
    env.AUDIT_BUCKET
  );

  if (result.success && result.status === "completed") {
    ctx.waitUntil(
      flushCharges(env.DB, body.userId, env).then((r) => {
        if (r.chargeCount && r.chargeCount > 0) {
          console.log(`[flush] q-emplois userId=${body.userId} charged ${r.amountCents} cents`);
        }
      })
    );
  }

  return jsonResponse(
    result.success
      ? {
          success: true,
          taskId: result.taskId,
          status: result.status,
          estimatedReviewTime: result.estimatedReviewTime,
          matches: result.matches,
          score: result.score,
          rationale: result.rationale,
          article52Disclosure: result.article52Disclosure,
        }
      : { success: false, taskId: result.taskId, error: result.error, article52Disclosure: result.article52Disclosure },
    result.success ? 200 : 500
  );
}

async function handleAdminMetricsRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const metrics = await getDashboardMetrics(env.DB, env);
  return new Response(JSON.stringify(metrics), {
    headers: { "Content-Type": "application/json", ...ADMIN_CORS_HEADERS },
  });
}

async function handleAdminHealthRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const health = await deepHealthCheck(env.DB, env.AUDIT_BUCKET, env);
  return new Response(JSON.stringify(health), {
    status: health.healthy ? 200 : 503,
    headers: { "Content-Type": "application/json", ...ADMIN_CORS_HEADERS },
  });
}

async function handleAdminRealtimeRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const stream = await getRealtimeStream(env.DB);
  return new Response(JSON.stringify(stream), {
    headers: { "Content-Type": "application/json", ...ADMIN_CORS_HEADERS },
  });
}

async function handleAdminAddCreditsRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const amountParam = url.searchParams.get("amount");
  const amount = amountParam ? parseInt(amountParam, 10) : 0;

  if (!userId || isNaN(amount) || amount < 1) {
    return jsonResponse({ error: "Missing userId or invalid amount (min 1)" }, 400);
  }

  await addCredits(userId, amount, env.DB);
  const balance = await getCreditBalance(userId, env.DB);

  return jsonResponse({
    success: true,
    userId,
    creditsAdded: amount,
    newBalance: balance.creditBalance,
    message: `Added ${amount} credits. Balance: ${balance.creditBalance}`,
  });
}

async function handleAdminAttributionRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const { getAttributionDashboard } = await import("./marketing/attribution");
  const dashboard = await getAttributionDashboard(env.DB);
  return jsonResponse(dashboard);
}

async function handleAdminAttributionCreateRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body: { source: string; campaign?: string; creator?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.source) {
    return jsonResponse({ error: "Missing source" }, 400);
  }

  const baseUrl = new URL(request.url).origin;
  const { generateAttributionLink } = await import("./marketing/attribution");
  const result = await generateAttributionLink(
    body.source,
    body.campaign ?? null,
    body.creator ?? null,
    env.DB,
    baseUrl
  );

  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }
  return jsonResponse({ success: true, url: result.url, id: result.id });
}

async function handleAdminContentCalendarRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const today = url.searchParams.get("today") !== "false";
  const todayStr = new Date().toISOString().slice(0, 10);

  const query = today
    ? `SELECT * FROM content_calendar WHERE scheduled_date = ? ORDER BY platform`
    : `SELECT * FROM content_calendar ORDER BY scheduled_date DESC, platform LIMIT 50`;
  const stmt = today
    ? env.DB.prepare(query).bind(todayStr)
    : env.DB.prepare(query);

  const rows = await stmt.all();
  const items = (rows.results ?? []) as Array<Record<string, unknown>>;

  return jsonResponse({ items, today: todayStr });
}

async function handleAdminContentCalendarCreateRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body: {
    platform: string;
    content_type?: string;
    title?: string;
    body?: string;
    angle?: string;
    scheduled_date?: string;
    attribution_link?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.platform) {
    return jsonResponse({ error: "Missing platform" }, 400);
  }

  const id = `cc-${crypto.randomUUID().slice(0, 8)}`;
  const scheduled = body.scheduled_date ?? new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO content_calendar (id, platform, content_type, title, body, angle, scheduled_date, attribution_link)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.platform,
      body.content_type ?? null,
      body.title ?? null,
      body.body ?? null,
      body.angle ?? null,
      scheduled,
      body.attribution_link ?? null
    )
    .run();

  return jsonResponse({ success: true, id });
}

async function handleAdminContentCalendarMarkPostedRoute(
  id: string,
  request: Request,
  env: Env
): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body: { engagement_score?: number; clicks?: number; conversions?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `UPDATE content_calendar SET posted = 1, posted_date = ?, engagement_score = ?, clicks = ?, conversions = ?
     WHERE id = ?`
  )
    .bind(
      todayStr,
      body.engagement_score ?? null,
      body.clicks ?? null,
      body.conversions ?? null,
      id
    )
    .run();

  return jsonResponse({ success: true, id });
}

async function handleWhaleSubscribeRoute(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization")?.replace("Bearer ", "") ?? request.headers.get("X-API-Key");
  if (env.WHALE_API_KEY && (!auth || auth !== env.WHALE_API_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { userId: string; chain: "btc" | "eth"; minValueUsd?: number; webhookUrl?: string; email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.userId || !body.chain) {
    return jsonResponse({ error: "Missing userId or chain" }, 400);
  }

  const result = await createSubscription(env.DB, {
    userId: body.userId,
    chain: body.chain,
    minValueUsd: body.minValueUsd ?? 100000,
    webhookUrl: body.webhookUrl,
    email: body.email,
    tenantId: env.TENANT?.id,
  });

  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }

  return jsonResponse({
    success: true,
    subscriptionId: result.subscriptionId,
    message: "ETH: Alchemy. BTC: Blockchair. Both chains monitored.",
  });
}

async function handleWhaleAlertsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chain = url.searchParams.get("chain") ?? undefined;
  const minValue = url.searchParams.get("minValue");
  const since = url.searchParams.get("since") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  const alerts = await getWhaleAlerts(env.DB, {
    chain,
    minValue: minValue ? parseFloat(minValue) : undefined,
    since,
    limit,
  });

  return jsonResponse({ alerts, mode: env.ALCHEMY_API_KEY ? "live" : "MVP simulation" });
}

function getReferralUserId(request: Request, method: "GET" | "POST"): string | null {
  if (method === "GET") {
    const url = new URL(request.url);
    return url.searchParams.get("userId") ?? request.headers.get("X-User-Id");
  }
  return null;
}

async function handleReferralCreateRoute(request: Request, env: Env): Promise<Response> {
  let body: { userId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const result = await generateReferralCode(body.userId, env.DB);
  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }
  return jsonResponse({
    success: true,
    code: result.code,
    shareUrl: result.shareUrl,
  });
}

async function handleReferralStatsRoute(request: Request, env: Env): Promise<Response> {
  const userId = getReferralUserId(request, "GET");
  if (!userId) {
    return jsonResponse({ error: "Missing userId (query param or X-User-Id header)" }, 400);
  }

  const stats = await getReferralStats(userId, env.DB);
  if (!stats.found) {
    return jsonResponse({ error: "No referral code. Call POST /referrals/create first." }, 404);
  }
  return jsonResponse({
    code: stats.code,
    totalReferrals: stats.totalReferrals,
    totalEarnings: (stats.totalEarningsCents ?? 0) / 100,
    shareUrl: stats.shareUrl,
  });
}

async function handleReferralBalanceRoute(request: Request, env: Env): Promise<Response> {
  const userId = getReferralUserId(request, "GET");
  if (!userId) {
    return jsonResponse({ error: "Missing userId (query param or X-User-Id header)" }, 400);
  }

  const { balanceCents } = await getReferralBalance(userId, env.DB);
  return jsonResponse({
    balanceCents,
    balanceUsd: (balanceCents / 100).toFixed(2),
  });
}

async function handleReferralWithdrawRoute(request: Request, env: Env): Promise<Response> {
  let body: { userId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const result = await withdrawReferralBalance(body.userId, env.DB);
  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }
  return jsonResponse({
    success: true,
    amountCents: result.amountCents,
    amountUsd: ((result.amountCents ?? 0) / 100).toFixed(2),
    message: "Withdrawal recorded. Payout via Stripe Connect coming soon.",
  });
}

async function handleBillingCreateCustomerRoute(request: Request, env: Env): Promise<Response> {
  let body: { userId: string; email?: string; country?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId) {
    return jsonResponse({ error: "Missing userId" }, 400);
  }

  const country = body.country ?? "US";
  const result = await createBillingCustomer(body.userId, country, env, body.email);
  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }
  return jsonResponse({
    success: true,
    provider: result.provider,
    customerId: result.customerId,
  });
}

async function handleAdminBillingStatusRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return jsonResponse({ error: "Missing userId query param" }, 400);
  }

  const [ledgerRows, customerRow] = await Promise.all([
    env.DB.prepare(
      `SELECT reservation_id, amount_cents, status, created_at FROM usage_ledger
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
      .bind(userId)
      .all<{ reservation_id: string; amount_cents: number; status: string; created_at: string }>(),
    env.DB.prepare(
      `SELECT stripe_customer_id, paddle_customer_id, country FROM billing_customers WHERE user_id = ?`
    )
      .bind(userId)
      .first<{ stripe_customer_id: string | null; paddle_customer_id: string | null; country: string }>(),
  ]);

  const charges = ledgerRows.results ?? [];
  const pendingCents = charges
    .filter((c) => c.status === "reserved" || c.status === "confirmed")
    .reduce((sum, c) => sum + c.amount_cents, 0);

  return jsonResponse({
    userId,
    pendingCents,
    hasStripeCustomer: !!customerRow?.stripe_customer_id,
    hasPaddleCustomer: !!customerRow?.paddle_customer_id,
    country: customerRow?.country ?? "US",
    ledger: charges.map((c) => ({
      reservationId: c.reservation_id,
      amountCents: c.amount_cents,
      status: c.status,
      createdAt: c.created_at,
    })),
  });
}

async function handleBillingFlushRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  let userId = url.searchParams.get("userId");
  if (!userId) {
    try {
      const body = (await request.json()) as { userId?: string };
      userId = body.userId ?? null;
    } catch {
      // No body or invalid JSON
    }
  }
  if (!userId) {
    return jsonResponse({ error: "Missing userId (body or ?userId=)" }, 400);
  }

  const result = await forceFlushCharges(env.DB, userId, env);
  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }
  return jsonResponse({
    success: true,
    amountCents: result.amountCents,
    chargeCount: result.chargeCount,
    message: result.chargeCount ? "Charges flushed to Stripe/Paddle" : "No confirmed charges to flush",
  });
}

async function handleBillingCheckoutRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const amountParam = url.searchParams.get("amount");

  if (!userId) {
    return jsonResponse({ error: "Missing userId query param" }, 400);
  }

  const amountCents = amountParam ? parseInt(amountParam, 10) : 50;
  if (isNaN(amountCents) || amountCents < 50) {
    return jsonResponse({ error: "Amount must be at least 50 cents ($0.50)" }, 400);
  }

  const baseUrl = url.origin;
  const result = await createCheckoutSession(userId, amountCents, env.DB, env, baseUrl);

  if (!result.success) {
    return jsonResponse({ error: result.error }, 500);
  }

  return jsonResponse({
    checkoutUrl: result.checkoutUrl,
    sessionId: result.sessionId,
  });
}

async function handleStripeWebhookRoute(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  const result = await handleCheckoutWebhook(rawBody, signature, env.DB, env);

  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAgentPollRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const secret = url.searchParams.get("secret");

  if (!agentId || !secret) {
    return jsonResponse({ error: "Missing agentId or secret query params" }, 400);
  }

  const result = await agentPoll(env.DB, agentId, secret);
  if (!result.success) {
    return jsonResponse({ error: result.error }, 401);
  }
  return jsonResponse({ tasks: result.tasks ?? [] });
}

async function handleAgentCompleteRoute(request: Request, env: Env): Promise<Response> {
  let body: { taskId: string; result: unknown; agentId: string; secret: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.taskId || !body.agentId || !body.secret) {
    return jsonResponse({ error: "Missing taskId, agentId, or secret" }, 400);
  }

  const result = await agentComplete(
    env.DB,
    env,
    body.agentId,
    body.secret,
    body.taskId,
    body.result
  );
  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }
  return jsonResponse({
    success: true,
    earnings: result.earnings,
    message: `Earned $${((result.earnings ?? 0) / 100).toFixed(2)}`,
  });
}

async function handleAgentRegisterRoute(request: Request, env: Env): Promise<Response> {
  let body: { agentId: string; name: string; capabilities?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.agentId || !body.name) {
    return jsonResponse({ error: "Missing agentId or name" }, 400);
  }

  const result = await agentRegister(
    env.DB,
    body.agentId,
    body.name,
    body.capabilities ?? ["ollama"]
  );
  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }
  return jsonResponse({
    success: true,
    secret: result.secret,
    message: "Save the secret - it won't be shown again",
  });
}

async function handleAgentSubmitRoute(request: Request, env: Env): Promise<Response> {
  let body: { userId: string; agentId: string; prompt: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.userId || !body.agentId || !body.prompt) {
    return jsonResponse({ error: "Missing userId, agentId, or prompt" }, 400);
  }

  const result = await agentSubmitTask(
    env.DB,
    env,
    body.userId,
    body.agentId,
    body.prompt
  );
  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }
  return jsonResponse({
    success: true,
    taskId: result.taskId,
    message: "Task queued for agent. Poll /agent/poll to pick it up.",
  });
}

async function handleZyeuteScrapeRoute(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("Authorization")?.replace("Bearer ", "") ?? request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.ZYEUTE_API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { sourceUrl?: string; affiliateConfig?: Record<string, number> } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    // Use defaults
  }

  const sourceUrl = body.sourceUrl ?? "https://example.com/feed1";
  const affiliateConfig = body.affiliateConfig ?? { amazon: 0.04, experiences: 0.08, services: 0.12 };

  const job = await scrapeAndMonetize(sourceUrl, affiliateConfig, env.DB);
  await autoPublish(job.id, env.DB);

  return jsonResponse({
    success: true,
    contentId: job.id,
    title: job.title,
    status: "published",
  });
}

async function handleZyeuteEarningsRoute(env: Env): Promise<Response> {
  const earnings = await getEarnings(env.DB);
  return jsonResponse(earnings);
}

async function handleQEmploisStatusRoute(taskId: string, env: Env): Promise<Response> {
  const status = await getQEmploisStatus(taskId, env.DB);
  if (!status.found) {
    return jsonResponse({ error: "Task not found" }, 404);
  }
  return jsonResponse({
    taskId: status.taskId,
    status: status.status,
    humanReviewPending: status.humanReviewPending,
    createdAt: status.createdAt,
    completedAt: status.completedAt,
  });
}

async function handleTaskRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const start = Date.now();

  // GDPR data residency check
  const residency = validateDataResidency(request);
  if (!residency.allowed) {
    return jsonResponse({ error: residency.reason }, 403);
  }

  let body: TaskRequest;
  try {
    body = (await request.json()) as TaskRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { service, tenantId, payload } = body;
  if (!service || !tenantId) {
    return jsonResponse({ error: "Missing service or tenantId" }, 400);
  }

  // Execute task with self-healing retry
  const result = await executeTask(service, tenantId, payload, request, env);

  // On failure after retries, queue to failed_tasks for cron reprocessing
  if (!result.success && result.error) {
    ctx.waitUntil(
      queueFailedTask(env, { service, tenantId, payload, error: result.error })
    );
  }

  // Bill on success
  if (result.success) {
    ctx.waitUntil(
      routeAndCharge(
        { request, tenantId, taskCount: 1, customerId: undefined },
        env
      ).then((billing) => {
        if (!billing.success) {
          console.error("Billing failed:", billing.error);
        }
      })
    );
  }

  const elapsed = Date.now() - start;
  const response: TaskResult = {
    success: result.success,
    taskId: result.taskId,
    data: result.data,
    error: result.error,
    requiresHumanReview: result.requiresHumanReview,
  };

  return jsonResponse(response, result.success ? 200 : 500, {
    "Cache-Control": "no-store",
    "X-Response-Time-Ms": String(elapsed),
  });
}

async function executeTask(
  service: string,
  tenantId: string,
  payload: Record<string, unknown>,
  request: Request,
  env: Env
): Promise<TaskResult & { taskId?: string }> {
  switch (service) {
    case "openclaw": {
      const result = await executeOpenClawTask(
        { tenantId, payload },
        env.OPENCLAW_API_KEY ?? "",
        env.DB
      );
      return { ...result, taskId: result.data?.taskId ?? crypto.randomUUID() };
    }
    case "q-emplois": {
      const result = await executeQEmploisTask(
        { tenantId, payload },
        request,
        env
      );
      return { ...result, taskId: crypto.randomUUID() };
    }
    case "zyeute-content": {
      const result = await executeZyeuteContentTask(
        { tenantId, payload },
        parseInt(env.MAX_RETRIES ?? "3", 10),
        env.DB
      );
      return { ...result, taskId: crypto.randomUUID() };
    }
    default:
      return { success: false, error: `Unknown service: ${service}` };
  }
}

async function queueFailedTask(
  env: Env,
  task: { service: string; tenantId: string; payload: Record<string, unknown>; error: string }
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO failed_tasks (id, service, tenant_id, payload, error, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(
        crypto.randomUUID(),
        task.service,
        task.tenantId,
        JSON.stringify(task.payload),
        task.error
      )
      .run();
  } catch (err) {
    console.error("Failed to queue task:", err);
    await logToR2(env.AUDIT_BUCKET, {
      timestamp: new Date().toISOString(),
      event: "failed_task_queue_error",
      service: task.service,
      tenantId: task.tenantId,
      payload: { error: task.error, queueError: String(err) },
    });
  }
}

async function reprocessFailedTasks(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, service, tenant_id, payload, error FROM failed_tasks
     WHERE retry_count < 3 ORDER BY created_at LIMIT 10`
  ).all();

  const tasks = (rows.results ?? []) as Array<{
    id: string;
    service: string;
    tenant_id: string;
    payload: string;
    error: string;
  }>;

  for (const task of tasks) {
    const payload = JSON.parse(task.payload || "{}") as Record<string, unknown>;
    // Create synthetic request for geo routing
    const request = new Request("https://omniclaws.example/api/task", {
      method: "POST",
      headers: { "cf-ipcountry": "US" },
    });

    const result = await executeTask(
      task.service,
      task.tenant_id,
      payload,
      request,
      env
    );

    if (result.success) {
      await env.DB.prepare(
        `DELETE FROM failed_tasks WHERE id = ?`
      ).bind(task.id).run();
    } else {
      await env.DB.prepare(
        `UPDATE failed_tasks SET retry_count = retry_count + 1, last_retry_at = datetime('now') WHERE id = ?`
      ).bind(task.id).run();
    }
  }
}

// Admin: Test email handler
async function handleTestEmailRoute(request: Request, env: Env): Promise<Response> {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  try {
    const body = await request.json() as { type: string; email: string };
    const { type, email } = body;

    if (!type || !email) {
      return jsonResponse({ error: "Missing type or email" }, 400);
    }

    const { getEmailService } = await import("./email/resend");
    const emailService = getEmailService(env);

    let result;
    switch (type) {
      case "welcome":
        result = await emailService.sendWelcomeEmail(email, {
          userId: "test-user-123",
          freeTasks: 50,
          signupDate: new Date().toISOString(),
        });
        break;
      case "low-credits":
        result = await emailService.sendLowCreditsEmail(email, {
          userId: "test-user-123",
          remaining: 8,
          used: 42,
          total: 50,
        });
        break;
      case "weekly":
        result = await emailService.sendWeeklyReport(email, {
          userId: "test-user-123",
          weekStart: "2024-02-12",
          tasksExecuted: 127,
          creditsSpent: 6.35,
          topServices: [
            { service: "q-emplois", count: 89 },
            { service: "zyeute-content", count: 38 },
          ],
          remainingCredits: 43,
        });
        break;
      default:
        return jsonResponse({ error: "Unknown email type. Use: welcome, low-credits, weekly" }, 400);
    }

    if (result.error) {
      return jsonResponse({ error: "Email failed", details: result.error }, 500);
    }

    return jsonResponse({
      success: true,
      type,
      email,
      messageId: result.id,
    });
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON", details: String(err) }, 400);
  }
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
