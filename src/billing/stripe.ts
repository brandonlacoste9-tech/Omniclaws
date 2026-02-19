/**
 * Stripe Integration: US/CA direct billing
 * Usage-based metering with per-task pricing
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 * - STRIPE_SECRET_KEY: Your Stripe secret key (sk_...)
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret (whsec_...)
 */

import { circuitBreakers } from '../utils/failover';
import { logBillingEvent } from '../compliance/audit-logger';

export interface StripeEnv {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

export interface UsageRecord {
  userId: string;
  quantity: number;
  timestamp: number;
  description: string;
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const TASK_PRICE = 0.05; // $0.05 per task

/**
 * Creates a Stripe customer for US/CA user
 */
export async function createStripeCustomer(
  env: StripeEnv,
  userId: string,
  email: string,
  countryCode: string
): Promise<string> {
  return circuitBreakers.stripe.execute(async () => {
    // ENVIRONMENT VARIABLE REQUIRED: STRIPE_SECRET_KEY
    const params = new URLSearchParams({
      email,
      description: `Omniclaws User ${userId}`,
      'metadata[user_id]': userId,
      'metadata[country]': countryCode,
    });
    
    const response = await fetch(`${STRIPE_API_BASE}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    
    if (!response.ok) {
      throw new Error(`Stripe API error: ${response.status} ${await response.text()}`);
    }
    
    const data = await response.json() as { id: string };
    const customerId = data.id;
    
    // Log billing event
    await logBillingEvent(env, userId, 'customer_created', {
      provider: 'stripe',
      customerId,
      countryCode,
    });
    
    return customerId;
  });
}

/**
 * Records usage for Stripe metered billing
 * Creates usage record that will be invoiced monthly
 */
export async function recordStripeUsage(
  env: StripeEnv,
  record: UsageRecord
): Promise<void> {
  return circuitBreakers.stripe.execute(async () => {
    const user = await env.DB.prepare(
      'SELECT customer_id FROM users WHERE id = ?'
    ).bind(record.userId).first();
    
    if (!user?.customer_id) {
      throw new Error('Stripe customer not found for user');
    }
    
    // Store usage in database
    await env.DB.prepare(`
      INSERT INTO usage (id, user_id, task_id, service_type, amount, billing_period, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      record.userId,
      'usage-record',
      'metered',
      record.quantity * TASK_PRICE,
      getCurrentBillingPeriod(),
      record.timestamp
    ).run();
    
    await logBillingEvent(env, record.userId, 'usage_recorded', {
      provider: 'stripe',
      quantity: record.quantity,
      amount: record.quantity * TASK_PRICE,
      description: record.description,
    });
  });
}

/**
 * Creates a Stripe checkout session for immediate payment
 */
export async function createStripeCheckout(
  env: StripeEnv,
  userId: string,
  amount: number,
  description: string
): Promise<string> {
  return circuitBreakers.stripe.execute(async () => {
    const user = await env.DB.prepare(
      'SELECT customer_id FROM users WHERE id = ?'
    ).bind(userId).first();
    
    if (!user?.customer_id) {
      throw new Error('Stripe customer not found');
    }
    
    // ENVIRONMENT VARIABLE REQUIRED: STRIPE_SECRET_KEY
    const params = new URLSearchParams({
      'customer': user.customer_id as string,
      'mode': 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': description,
      'line_items[0][price_data][unit_amount]': Math.round(amount * 100).toString(),
      'line_items[0][quantity]': '1',
      'success_url': 'https://omniclaws.example.com/success',
      'cancel_url': 'https://omniclaws.example.com/cancel',
      'metadata[user_id]': userId,
    });
    
    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    
    if (!response.ok) {
      throw new Error(`Stripe API error: ${response.status}`);
    }
    
    const data = await response.json() as { url: string };
    return data.url;
  });
}

/**
 * Verifies Stripe webhook signature
 * Ensures webhook requests are authentic
 */
export async function verifyStripeWebhook(
  signature: string,
  rawBody: string,
  secret: string
): Promise<boolean> {
  // Stripe signature format: t=timestamp,v1=signature
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
  
  const timestamp = parts.t;
  const expectedSignature = parts.v1;
  
  if (!timestamp || !expectedSignature) {
    return false;
  }
  
  // Create signed payload
  const signedPayload = `${timestamp}.${rawBody}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );
  
  const actualSignature = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return actualSignature === expectedSignature;
}

/**
 * Handles Stripe webhook events
 */
export async function handleStripeWebhook(
  env: StripeEnv,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  switch (eventType) {
    case 'customer.created':
      await handleCustomerCreated(env, eventData);
      break;
    case 'customer.deleted':
      await handleCustomerDeleted(env, eventData);
      break;
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(env, eventData);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(env, eventData);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(env, eventData);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(env, eventData);
      break;
    default:
      console.log(`Unhandled Stripe webhook: ${eventType}`);
  }
}

async function handleCustomerCreated(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'customer_created', { provider: 'stripe', data });
  }
}

async function handleCustomerDeleted(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'customer_deleted', { provider: 'stripe', data });
  }
}

async function handlePaymentSucceeded(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'payment_succeeded', { provider: 'stripe', data });
  }
}

async function handlePaymentFailed(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'payment_failed', { provider: 'stripe', data });
  }
}

async function handleInvoicePaid(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    // Mark usage as invoiced
    await env.DB.prepare(`
      UPDATE usage 
      SET invoiced = 1
      WHERE user_id = ? AND billing_period = ? AND invoiced = 0
    `).bind(userId, getCurrentBillingPeriod()).run();
    
    await logBillingEvent(env, userId, 'invoice_paid', { provider: 'stripe', data });
  }
}

async function handleInvoicePaymentFailed(env: StripeEnv, data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'invoice_payment_failed', { provider: 'stripe', data });
  }
}

/**
 * Gets current billing period in YYYY-MM format
 */
function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
