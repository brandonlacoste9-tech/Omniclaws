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
