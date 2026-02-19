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
/**
 * Paddle EU/UK MoR integration - handles VAT automatically
 * Merchant of Record: Paddle collects and remits EU VAT
 * env.PADDLE_API_KEY required - set via wrangler secret put PADDLE_API_KEY
 * Sandbox: use PADDLE_SANDBOX=true for sandbox-api.paddle.com
 */

const PADDLE_API_URL = "https://api.paddle.com";
const PADDLE_SANDBOX_URL = "https://sandbox-api.paddle.com";
const REQUEST_TIMEOUT_MS = 15000;

export interface PaddleChargeResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface PaddleCustomerResult {
  success: boolean;
  customerId?: string;
  error?: string;
}

/**
 * Charge customer via Paddle API.
 * Retries once on network timeout.
 */
export async function chargePaddle(
  customerId: string,
  amountCents: number,
  currency: string,
  apiKey: string,
  sandbox: boolean = false
): Promise<PaddleChargeResult> {
  if (!apiKey) {
    return { success: false, error: "PADDLE_API_KEY not configured" };
  }

  const baseUrl = sandbox ? PADDLE_SANDBOX_URL : PADDLE_API_URL;
  const url = `${baseUrl}/transactions`;

  const body = {
    items: [
      {
        quantity: 1,
        price: {
          description: "AI Task Execution",
          unit_price: {
            amount: String(amountCents),
            currency_code: currency.toUpperCase(),
          },
        },
      },
    ],
    customer_id: customerId,
    currency_code: currency.toUpperCase(),
  };

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  try {
    const response = await doFetch();

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Paddle API ${response.status}: ${errText}` };
    }

    const data = (await response.json()) as { data?: { id?: string } };
    return {
      success: true,
      transactionId: data.data?.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort") || message.includes("timeout")) {
      try {
        const retryRes = await doFetch();
        if (!retryRes.ok) {
          const errText = await retryRes.text();
          return { success: false, error: `Paddle API retry ${retryRes.status}: ${errText}` };
        }
        const data = (await retryRes.json()) as { data?: { id?: string } };
        return { success: true, transactionId: data.data?.id };
      } catch (retryErr) {
        return {
          success: false,
          error: `Paddle timeout retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        };
      }
    }
    return { success: false, error: message };
  }
}

/**
 * Create customer in Paddle for storage in D1.
 * Country is passed at transaction time, not customer creation.
 */
export async function createPaddleCustomer(
  email: string,
  _country: string,
  apiKey: string,
  sandbox: boolean = false
): Promise<PaddleCustomerResult> {
  if (!apiKey) {
    return { success: false, error: "PADDLE_API_KEY not configured" };
  }

  const baseUrl = sandbox ? PADDLE_SANDBOX_URL : PADDLE_API_URL;
  const url = `${baseUrl}/customers`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        name: "Omniclaws Customer",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Paddle API ${response.status}: ${errText}` };
    }

    const data = (await response.json()) as { data?: { id?: string } };
    return {
      success: true,
      customerId: data.data?.id,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
