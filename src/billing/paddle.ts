/**
 * Paddle Integration: EU/UK Merchant of Record billing
 * Handles VAT compliance automatically via Paddle MoR model
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 * - PADDLE_API_KEY: Your Paddle API key
 * - PADDLE_VENDOR_ID: Your Paddle vendor ID
 */

import { circuitBreakers } from '../utils/failover';
import { logBillingEvent } from '../compliance/audit-logger';

export interface PaddleEnv {
  PADDLE_API_KEY: string;
  PADDLE_VENDOR_ID: string;
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

export interface PaddleSubscription {
  subscriptionId: string;
  customerId: string;
  status: string;
  nextBillingDate: string;
}

export interface UsageCharge {
  userId: string;
  amount: number;
  description: string;
  quantity: number;
}

const PADDLE_API_BASE = 'https://api.paddle.com/v2';

/**
 * Creates a Paddle customer for EU/UK user
 */
export async function createPaddleCustomer(
  env: PaddleEnv,
  userId: string,
  email: string,
  countryCode: string
): Promise<string> {
  return circuitBreakers.paddle.execute(async () => {
    // ENVIRONMENT VARIABLE REQUIRED: PADDLE_API_KEY
    const response = await fetch(`${PADDLE_API_BASE}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        country_code: countryCode,
        custom_data: {
          omniclaws_user_id: userId,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Paddle API error: ${response.status} ${await response.text()}`);
    }
    
    const data = await response.json() as { data: { id: string } };
    const customerId = data.data.id;
    
    // Log billing event
    await logBillingEvent(env, userId, 'customer_created', {
      provider: 'paddle',
      customerId,
      countryCode,
    });
    
    return customerId;
  });
}

/**
 * Records usage-based charge for Paddle customer
 * Paddle will aggregate and invoice at billing cycle
 */
export async function recordPaddleUsage(
  env: PaddleEnv,
  charge: UsageCharge
): Promise<void> {
  return circuitBreakers.paddle.execute(async () => {
    const user = await env.DB.prepare(
      'SELECT customer_id FROM users WHERE id = ?'
    ).bind(charge.userId).first();
    
    if (!user?.customer_id) {
      throw new Error('Paddle customer not found for user');
    }
    
    // In production, use Paddle's usage-based billing API
    // For now, store in local database for aggregation
    await env.DB.prepare(`
      INSERT INTO usage (id, user_id, task_id, service_type, amount, billing_period, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      charge.userId,
      'usage-charge',
      'usage-based',
      charge.amount,
      getCurrentBillingPeriod(),
      Date.now()
    ).run();
    
    await logBillingEvent(env, charge.userId, 'usage_recorded', {
      provider: 'paddle',
      amount: charge.amount,
      quantity: charge.quantity,
      description: charge.description,
    });
  });
}

/**
 * Creates a one-time payment link for immediate charges
 */
export async function createPaddlePaymentLink(
  env: PaddleEnv,
  userId: string,
  amount: number,
  description: string
): Promise<string> {
  return circuitBreakers.paddle.execute(async () => {
    // ENVIRONMENT VARIABLE REQUIRED: PADDLE_API_KEY
    const response = await fetch(`${PADDLE_API_BASE}/payment-links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        amount: {
          amount: Math.round(amount * 100).toString(), // Convert to cents
          currency: 'EUR',
        },
        custom_data: {
          omniclaws_user_id: userId,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Paddle API error: ${response.status}`);
    }
    
    const data = await response.json() as { data: { url: string } };
    return data.data.url;
  });
}

/**
 * Verifies Paddle webhook signature
 * Ensures webhook requests are authentic
 */
export async function verifyPaddleWebhook(
  signature: string,
  rawBody: string,
  secret: string
): Promise<boolean> {
  // Paddle uses HMAC SHA256 for webhook signatures
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
    encoder.encode(rawBody)
  );
  
  const expectedSignature = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return signature === expectedSignature;
}

/**
 * Handles Paddle webhook events
 */
export async function handlePaddleWebhook(
  env: PaddleEnv,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  switch (eventType) {
    case 'subscription.created':
      await handleSubscriptionCreated(env, eventData);
      break;
    case 'subscription.updated':
      await handleSubscriptionUpdated(env, eventData);
      break;
    case 'subscription.cancelled':
      await handleSubscriptionCancelled(env, eventData);
      break;
    case 'payment.succeeded':
      await handlePaymentSucceeded(env, eventData);
      break;
    case 'payment.failed':
      await handlePaymentFailed(env, eventData);
      break;
    default:
      console.log(`Unhandled Paddle webhook: ${eventType}`);
  }
}

async function handleSubscriptionCreated(env: PaddleEnv, data: Record<string, unknown>): Promise<void> {
  const customData = data.custom_data as Record<string, string> | undefined;
  const userId = customData?.omniclaws_user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'subscription_created', { provider: 'paddle', data });
  }
}

async function handleSubscriptionUpdated(env: PaddleEnv, data: Record<string, unknown>): Promise<void> {
  const customData = data.custom_data as Record<string, string> | undefined;
  const userId = customData?.omniclaws_user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'subscription_updated', { provider: 'paddle', data });
  }
}

async function handleSubscriptionCancelled(env: PaddleEnv, data: Record<string, unknown>): Promise<void> {
  const customData = data.custom_data as Record<string, string> | undefined;
  const userId = customData?.omniclaws_user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'subscription_cancelled', { provider: 'paddle', data });
  }
}

async function handlePaymentSucceeded(env: PaddleEnv, data: Record<string, unknown>): Promise<void> {
  const customData = data.custom_data as Record<string, string> | undefined;
  const userId = customData?.omniclaws_user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'payment_succeeded', { provider: 'paddle', data });
  }
}

async function handlePaymentFailed(env: PaddleEnv, data: Record<string, unknown>): Promise<void> {
  const customData = data.custom_data as Record<string, string> | undefined;
  const userId = customData?.omniclaws_user_id;
  
  if (userId) {
    await logBillingEvent(env, userId, 'payment_failed', { provider: 'paddle', data });
  }
}

/**
 * Gets current billing period in YYYY-MM format
 */
function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
