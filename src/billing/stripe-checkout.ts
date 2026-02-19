/**
 * Stripe Checkout integration
 * Hosted payment page for $0.50+ charges
 * Webhook: checkout.session.completed
 */

import type { D1Database } from "@cloudflare/workers-types";
import { createBillingCustomer } from "./router";
import { CREDIT_PACKS, type PackType } from "./credit-wallet";
import type { Env } from "../types";

const STRIPE_API_URL = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 15000;
const BASE_URL = "https://omniclaws.brandonlacoste9.workers.dev";

export interface CreateCheckoutSessionResult {
  success: boolean;
  sessionId?: string;
  checkoutUrl?: string;
  error?: string;
}

/**
 * Create Stripe Checkout Session for payment.
 * Returns URL to redirect customer to enter card details.
 */
export async function createCheckoutSession(
  userId: string,
  amountCents: number,
  db: D1Database,
  env: Env,
  baseUrl: string = BASE_URL
): Promise<CreateCheckoutSessionResult> {
  if (!env.STRIPE_SECRET_KEY) {
    return { success: false, error: "STRIPE_SECRET_KEY not configured" };
  }

  const customerResult = await createBillingCustomer(userId, "US", env);
  if (!customerResult.success || !customerResult.customerId || customerResult.provider !== "stripe") {
    return {
      success: false,
      error: customerResult.error ?? "Failed to get Stripe customer",
    };
  }

  const internalChargeId = crypto.randomUUID();

  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Omniclaws Automation",
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
    customer: customerResult.customerId,
    "metadata[userId]": userId,
    "metadata[internalChargeId]": internalChargeId,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${STRIPE_API_URL}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (data.error) {
      return { success: false, error: data.error.message ?? "Stripe error" };
    }

    if (!response.ok || !data.id) {
      return { success: false, error: "Failed to create Checkout Session" };
    }

    await db
      .prepare(
        `INSERT INTO billing_checkout_sessions (id, user_id, amount_cents, status, created_at)
         VALUES (?, ?, ?, 'pending', datetime('now'))`
      )
      .bind(internalChargeId, userId, amountCents)
      .run();

    return {
      success: true,
      sessionId: data.id,
      checkoutUrl: data.url ?? undefined,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Create Stripe Checkout for credit pack purchase.
 */
export async function createCreditPackCheckoutSession(
  userId: string,
  packType: PackType,
  db: D1Database,
  env: Env,
  baseUrl: string = BASE_URL,
  pricingMultiplier: number = 1.0,
  attributionRef?: string
): Promise<CreateCheckoutSessionResult> {
  if (!env.STRIPE_SECRET_KEY) {
    return { success: false, error: "STRIPE_SECRET_KEY not configured" };
  }

  const pack = CREDIT_PACKS[packType];
  if (!pack) {
    return { success: false, error: "Invalid pack type" };
  }

  const priceCents = Math.round(pack.priceCents * pricingMultiplier);
  if (priceCents < 50) {
    return { success: false, error: "Minimum charge is $0.50" };
  }

  const customerResult = await createBillingCustomer(userId, "US", env);
  if (!customerResult.success || !customerResult.customerId || customerResult.provider !== "stripe") {
    return {
      success: false,
      error: customerResult.error ?? "Failed to get Stripe customer",
    };
  }

  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(priceCents),
    "line_items[0][price_data][product_data][name]": pack.name,
    "line_items[0][price_data][product_data][description]": `${pack.credits} credits for Pro tasks`,
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
    customer: customerResult.customerId,
    "metadata[userId]": userId,
    "metadata[type]": "credit_pack",
    "metadata[packType]": packType,
    "metadata[credits]": String(pack.credits),
  });
  if (attributionRef) {
    params.set("metadata[attributionRef]", attributionRef);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${STRIPE_API_URL}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (data.error) {
      return { success: false, error: data.error.message ?? "Stripe error" };
    }

    if (!response.ok || !data.id) {
      return { success: false, error: "Failed to create Checkout Session" };
    }

    return {
      success: true,
      sessionId: data.id,
      checkoutUrl: data.url ?? undefined,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Verify Stripe webhook signature using HMAC-SHA256.
 */
async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const parts = signature.split(",").reduce(
    (acc, part) => {
      const [k, v] = part.split("=");
      if (k && v) acc[k] = v;
      return acc;
    },
    {} as Record<string, string>
  );
  const timestamp = parts["t"];
  const expectedSig = parts["v1"];
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const computedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSig === expectedSig;
}

export interface HandleCheckoutWebhookResult {
  success: boolean;
  error?: string;
}

/**
 * Handle Stripe webhook event (checkout.session.completed).
 * Validates signature, updates usage_ledger to processed.
 */
export async function handleCheckoutWebhook(
  rawBody: string,
  signature: string | null,
  db: D1Database,
  env: Env
): Promise<HandleCheckoutWebhookResult> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { success: false, error: "STRIPE_WEBHOOK_SECRET not configured" };
  }

  if (!signature) {
    return { success: false, error: "Missing Stripe-Signature header" };
  }

  const valid = await verifyStripeSignature(rawBody, signature, secret);
  if (!valid) {
    return { success: false, error: "Invalid webhook signature" };
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return { success: false, error: "Invalid JSON payload" };
  }

  if (event.type !== "checkout.session.completed") {
    return { success: true };
  }

  const session = event.data?.object as Record<string, unknown> | undefined;
  if (!session) {
    return { success: false, error: "Missing session object" };
  }

  const metadata = (session.metadata as Record<string, string>) ?? {};
  const userId = metadata.userId;
  const type = metadata.type;
  const sessionId = session.id as string;

  if (!userId) {
    return { success: false, error: "Missing metadata userId" };
  }

  if (type === "credit_pack") {
    const packType = metadata.packType as string;
    const credits = parseInt(metadata.credits ?? "0", 10);
    const amountCents = (session.amount_total as number) ?? 0;
    if (!credits || !packType) {
      return { success: false, error: "Invalid credit pack metadata" };
    }

    const existing = await db
      .prepare(`SELECT 1 FROM credit_purchases WHERE stripe_session_id = ?`)
      .bind(sessionId)
      .first();
    if (existing) {
      return { success: true };
    }

    const { addCredits } = await import("./credit-wallet");
    await addCredits(userId, credits, db);
    await db
      .prepare(
        `INSERT INTO credit_purchases (id, user_id, pack_type, credits_added, amount_cents, stripe_session_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), userId, packType, credits, amountCents, sessionId)
      .run();

    const { attributeConversion } = await import("../marketing/attribution");
    await attributeConversion(userId, metadata.attributionRef ?? null, amountCents, db);

    return { success: true };
  }

  const internalChargeId = metadata.internalChargeId;
  if (!internalChargeId) {
    return { success: false, error: "Missing metadata internalChargeId" };
  }

  const row = await db
    .prepare(
      `SELECT id, user_id, amount_cents FROM billing_checkout_sessions
       WHERE id = ? AND status = 'pending'`
    )
    .bind(internalChargeId)
    .first<{ id: string; user_id: string; amount_cents: number }>();

  if (!row) {
    return { success: true };
  }

  const ledgerRows = await db
    .prepare(
      `SELECT reservation_id, amount_cents FROM usage_ledger
       WHERE user_id = ? AND status = 'confirmed'
       ORDER BY created_at
       LIMIT 100`
    )
    .bind(userId)
    .all<{ reservation_id: string; amount_cents: number }>();

  const charges = ledgerRows.results ?? [];
  let remainingCents = row.amount_cents;

  for (const c of charges) {
    if (remainingCents <= 0) break;
    if (c.amount_cents > remainingCents) break;

    await db
      .prepare(
        `UPDATE usage_ledger SET status = 'processed', processed_at = datetime('now')
         WHERE reservation_id = ? AND status = 'confirmed'`
      )
      .bind(c.reservation_id)
      .run();

    remainingCents -= c.amount_cents;
  }

  await db
    .prepare(
      `UPDATE billing_checkout_sessions SET status = 'completed', completed_at = datetime('now')
       WHERE id = ?`
    )
    .bind(internalChargeId)
    .run();

  return { success: true };
}
