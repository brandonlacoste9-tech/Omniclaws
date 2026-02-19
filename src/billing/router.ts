/**
 * Billing Router: Routes billing requests to appropriate provider
 * Paddle for EU/UK (MoR model handles VAT)
 * Stripe for US/CA (direct billing)
 */

import { getPaymentProvider, type PaymentProvider } from '../utils/geo-router';
import { createPaddleCustomer, recordPaddleUsage } from './paddle';
import { createStripeCustomer, recordStripeUsage } from './stripe';
import type { UsageCharge } from './paddle';
import type { UsageRecord } from './stripe';

export interface BillingEnv {
  PADDLE_API_KEY: string;
  PADDLE_VENDOR_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

/**
 * Creates a customer in the appropriate billing system
 */
export async function createCustomer(
  env: BillingEnv,
  userId: string,
  email: string,
  countryCode: string
): Promise<{ provider: PaymentProvider; customerId: string }> {
  const provider = getPaymentProvider(countryCode);
  
  if (provider === 'unsupported') {
    throw new Error(`Payment provider not available for country: ${countryCode}`);
  }
  
  let customerId: string;
  
  if (provider === 'paddle') {
    customerId = await createPaddleCustomer(
      { ...env, PADDLE_API_KEY: env.PADDLE_API_KEY, PADDLE_VENDOR_ID: env.PADDLE_VENDOR_ID },
      userId,
      email,
      countryCode
    );
  } else {
    customerId = await createStripeCustomer(
      { ...env, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET },
      userId,
      email,
      countryCode
    );
  }
  
  // Update user record with provider and customer ID
  await env.DB.prepare(`
    UPDATE users 
    SET payment_provider = ?, customer_id = ?, updated_at = ?
    WHERE id = ?
  `).bind(provider, customerId, Date.now(), userId).run();
  
  return { provider, customerId };
}

/**
 * Records usage for billing
 * Routes to appropriate provider based on user's payment provider
 */
export async function recordUsage(
  env: BillingEnv,
  userId: string,
  quantity: number,
  description: string
): Promise<void> {
  // Get user's payment provider
  const user = await env.DB.prepare(
    'SELECT payment_provider FROM users WHERE id = ?'
  ).bind(userId).first();
  
  if (!user) {
    throw new Error('User not found');
  }
  
  const provider = user.payment_provider as PaymentProvider;
  const amount = quantity * 0.05; // $0.05 per task
  
  if (provider === 'paddle') {
    const charge: UsageCharge = {
      userId,
      amount,
      description,
      quantity,
    };
    await recordPaddleUsage(
      { ...env, PADDLE_API_KEY: env.PADDLE_API_KEY, PADDLE_VENDOR_ID: env.PADDLE_VENDOR_ID },
      charge
    );
  } else if (provider === 'stripe') {
    const record: UsageRecord = {
      userId,
      quantity,
      timestamp: Date.now(),
      description,
    };
    await recordStripeUsage(
      { ...env, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET },
      record
    );
  } else {
    throw new Error(`Invalid payment provider: ${provider}`);
  }
}

/**
 * Gets billing summary for a user
 */
export async function getBillingSummary(
  env: BillingEnv,
  userId: string,
  billingPeriod?: string
): Promise<{
  provider: string;
  totalAmount: number;
  totalTasks: number;
  invoiced: boolean;
}> {
  const period = billingPeriod || getCurrentBillingPeriod();
  
  const result = await env.DB.prepare(`
    SELECT 
      SUM(amount) as total_amount,
      COUNT(*) as total_tasks,
      MAX(invoiced) as invoiced
    FROM usage
    WHERE user_id = ? AND billing_period = ?
  `).bind(userId, period).first();
  
  const user = await env.DB.prepare(
    'SELECT payment_provider FROM users WHERE id = ?'
  ).bind(userId).first();
  
  return {
    provider: (user?.payment_provider as string) || 'unknown',
    totalAmount: (result?.total_amount as number) || 0,
    totalTasks: (result?.total_tasks as number) || 0,
    invoiced: !!result?.invoiced,
  };
}

/**
 * Handles incoming webhook from either Paddle or Stripe
 */
export async function handleWebhook(
  env: BillingEnv,
  provider: 'paddle' | 'stripe',
  signature: string,
  rawBody: string
): Promise<Response> {
  try {
    if (provider === 'paddle') {
      const { verifyPaddleWebhook, handlePaddleWebhook } = await import('./paddle');
      
      // ENVIRONMENT VARIABLE REQUIRED: PADDLE_VENDOR_ID (used as webhook secret)
      const isValid = await verifyPaddleWebhook(signature, rawBody, env.PADDLE_VENDOR_ID);
      
      if (!isValid) {
        return new Response('Invalid signature', { status: 401 });
      }
      
      const event = JSON.parse(rawBody);
      await handlePaddleWebhook(
        { ...env, PADDLE_API_KEY: env.PADDLE_API_KEY, PADDLE_VENDOR_ID: env.PADDLE_VENDOR_ID },
        event.event_type,
        event.data
      );
    } else {
      const { verifyStripeWebhook, handleStripeWebhook } = await import('./stripe');
      
      // ENVIRONMENT VARIABLE REQUIRED: STRIPE_WEBHOOK_SECRET
      const isValid = await verifyStripeWebhook(signature, rawBody, env.STRIPE_WEBHOOK_SECRET);
      
      if (!isValid) {
        return new Response('Invalid signature', { status: 401 });
      }
      
      const event = JSON.parse(rawBody);
      await handleStripeWebhook(
        { ...env, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET },
        event.type,
        event.data.object
      );
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response('Internal error', { status: 500 });
  }
}

/**
 * Gets current billing period in YYYY-MM format
 */
function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
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
