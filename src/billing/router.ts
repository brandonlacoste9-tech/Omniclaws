/**
 * Geo-based billing router: Paddle (EU/UK MoR), Stripe (US/CA)
 * processPayment: D1 billing_customers + real Stripe/Paddle API calls
 */

import { EU_EEA_COUNTRIES } from "../compliance/gdpr";
import { chargePaddle, createPaddleCustomer } from "./paddle";
import { chargeStripe, createStripeCustomer } from "./stripe";
import type { Env } from "../types";

const TASK_PRICE_CENTS = 5;

function getCurrency(country: string): string {
  const c = country.toUpperCase();
  if (c === "GB" || c === "UK") return "GBP";
  if (c === "CA") return "CAD";
  if (EU_EEA_COUNTRIES.has(c)) return "EUR";
  return "USD";
}

export interface ProcessPaymentResult {
  success: boolean;
  provider?: "stripe" | "paddle";
  transactionId?: string;
  error?: string;
}

export interface CreateCustomerResult {
  success: boolean;
  provider?: "stripe" | "paddle";
  customerId?: string;
  error?: string;
}

/**
 * Create billing customer (Stripe/Paddle) without charging.
 * Call before first charge to ensure customer exists.
 */
export async function createBillingCustomer(
  userId: string,
  country: string,
  env: Env,
  email?: string
): Promise<CreateCustomerResult> {
  const db = env.DB;
  const sandbox = env.PADDLE_SANDBOX === "true";

  await db
    .prepare(
      `INSERT INTO billing_customers (user_id, country) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET country = excluded.country`
    )
    .bind(userId, country.toUpperCase())
    .run();

  const row = await db
    .prepare(`SELECT paddle_customer_id, stripe_customer_id FROM billing_customers WHERE user_id = ?`)
    .bind(userId)
    .first<{ paddle_customer_id: string | null; stripe_customer_id: string | null }>();

  const usePaddle = EU_EEA_COUNTRIES.has(country.toUpperCase()) || !["US", "CA"].includes(country.toUpperCase());
  const useStripe = ["US", "CA"].includes(country.toUpperCase());
  const provider: "stripe" | "paddle" = usePaddle ? "paddle" : "stripe";

  if (provider === "paddle" && row?.paddle_customer_id) {
    return { success: true, provider: "paddle", customerId: row.paddle_customer_id };
  }
  if (provider === "stripe" && row?.stripe_customer_id) {
    return { success: true, provider: "stripe", customerId: row.stripe_customer_id };
  }

  const fallbackEmail = email ?? `${userId}@omniclaws.placeholder`;

  if (provider === "paddle" && env.PADDLE_API_KEY) {
    const create = await createPaddleCustomer(fallbackEmail, country, env.PADDLE_API_KEY, sandbox);
    if (create.success && create.customerId) {
      await db
        .prepare(
          `INSERT INTO billing_customers (user_id, paddle_customer_id, country) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET paddle_customer_id = excluded.paddle_customer_id, updated_at = datetime('now')`
        )
        .bind(userId, create.customerId, country.toUpperCase())
        .run();
      return { success: true, provider: "paddle", customerId: create.customerId };
    }
    return { success: false, provider: "paddle", error: create.error ?? "Failed to create Paddle customer" };
  }

  if (provider === "stripe" && env.STRIPE_SECRET_KEY) {
    const create = await createStripeCustomer(fallbackEmail, env.STRIPE_SECRET_KEY);
    if (create.success && create.customerId) {
      await db
        .prepare(
          `INSERT INTO billing_customers (user_id, stripe_customer_id, country) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id, updated_at = datetime('now')`
        )
        .bind(userId, create.customerId, country.toUpperCase())
        .run();
      return { success: true, provider: "stripe", customerId: create.customerId };
    }
    return { success: false, provider: "stripe", error: create.error ?? "Failed to create Stripe customer" };
  }

  return { success: false, provider, error: "Billing provider not configured" };
}

/**
 * Process payment: get/create billing customer, charge via Stripe or Paddle.
 * EU/EEA → Paddle (VAT handled), US/CA → Stripe, else → Paddle (global MoR).
 */
export async function processPayment(
  userId: string,
  amountCents: number,
  country: string,
  env: Env,
  email?: string
): Promise<ProcessPaymentResult> {
  const db = env.DB;
  const currency = getCurrency(country);
  const sandbox = env.PADDLE_SANDBOX === "true";

  await db
    .prepare(
      `INSERT INTO billing_customers (user_id, country) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET country = excluded.country`
    )
    .bind(userId, country.toUpperCase())
    .run();

  const row = await db
    .prepare(`SELECT paddle_customer_id, stripe_customer_id FROM billing_customers WHERE user_id = ?`)
    .bind(userId)
    .first<{ paddle_customer_id: string | null; stripe_customer_id: string | null }>();

  const usePaddle = EU_EEA_COUNTRIES.has(country.toUpperCase()) || !["US", "CA"].includes(country.toUpperCase());
  const useStripe = ["US", "CA"].includes(country.toUpperCase());

  let customerId: string | null = null;
  let provider: "stripe" | "paddle" = usePaddle ? "paddle" : "stripe";

  if (usePaddle) {
    customerId = row?.paddle_customer_id ?? null;
  } else {
    customerId = row?.stripe_customer_id ?? null;
  }

  if (!customerId) {
    const fallbackEmail = email ?? `${userId}@omniclaws.placeholder`;
    if (provider === "paddle" && env.PADDLE_API_KEY) {
      const create = await createPaddleCustomer(
        fallbackEmail,
        country,
        env.PADDLE_API_KEY,
        sandbox
      );
      if (create.success && create.customerId) {
        customerId = create.customerId;
        await db
          .prepare(
            `INSERT INTO billing_customers (user_id, paddle_customer_id, country) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET paddle_customer_id = excluded.paddle_customer_id, updated_at = datetime('now')`
          )
          .bind(userId, customerId, country.toUpperCase())
          .run();
      }
    } else if (provider === "stripe" && env.STRIPE_SECRET_KEY) {
      const create = await createStripeCustomer(fallbackEmail, env.STRIPE_SECRET_KEY);
      if (create.success && create.customerId) {
        customerId = create.customerId;
        await db
          .prepare(
            `INSERT INTO billing_customers (user_id, stripe_customer_id, country) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id, updated_at = datetime('now')`
          )
          .bind(userId, customerId, country.toUpperCase())
          .run();
      }
    }
  }

  if (!customerId) {
    const txId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO billing_transactions (id, user_id, amount_cents, currency, provider, status, error_message)
         VALUES (?, ?, ?, ?, ?, 'failed', ?)`
      )
      .bind(txId, userId, amountCents, currency, provider, "Failed to create customer")
      .run();
    return { success: false, provider, error: "Failed to create billing customer" };
  }

  const txId = crypto.randomUUID();
  let result: ProcessPaymentResult;

  if (provider === "paddle" && env.PADDLE_API_KEY) {
    const charge = await chargePaddle(
      customerId,
      amountCents,
      currency,
      env.PADDLE_API_KEY,
      sandbox
    );
    result = {
      success: charge.success,
      provider: "paddle",
      transactionId: charge.transactionId,
      error: charge.error,
    };
  } else if (provider === "stripe" && env.STRIPE_SECRET_KEY) {
    const charge = await chargeStripe(
      customerId,
      amountCents,
      currency,
      env.STRIPE_SECRET_KEY
    );
    result = {
      success: charge.success,
      provider: "stripe",
      transactionId: charge.chargeId,
      error: charge.error,
    };
  } else {
    result = { success: false, provider, error: "Billing provider not configured" };
  }

  await db
    .prepare(
      `INSERT INTO billing_transactions (id, user_id, amount_cents, currency, provider, provider_transaction_id, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      txId,
      userId,
      amountCents,
      currency,
      provider,
      result.transactionId ?? null,
      result.success ? "succeeded" : "failed",
      result.error ?? null
    )
    .run();

  return result;
}

export interface BillingRequest {
  request: Request;
  tenantId: string;
  taskCount: number;
  customerId?: string;
}

export interface BillingResult {
  success: boolean;
  provider: "stripe" | "paddle";
  transactionId?: string;
  error?: string;
}

/**
 * Legacy: Route billing for /api/task (no usage ledger).
 * Uses processPayment when billing_customers exists.
 */
export async function routeAndCharge(
  params: BillingRequest,
  env: Env
): Promise<BillingResult> {
  const country = params.request.headers.get("cf-ipcountry") ?? "US";
  const priceCents = parseInt(env.TASK_PRICE_CENTS ?? String(TASK_PRICE_CENTS), 10);
  const amountCents = priceCents * params.taskCount;

  if (amountCents < 50) {
    return { success: true, provider: "paddle", transactionId: "batched" };
  }

  const result = await processPayment(
    params.tenantId,
    amountCents,
    country,
    env
  );

  return {
    success: result.success ?? false,
    provider: result.provider ?? "paddle",
    transactionId: result.transactionId,
    error: result.error,
  };
}
