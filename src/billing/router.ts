/**
 * Billing Router: Geo-based routing to Paddle (EU/UK) or Stripe (US/CA)
 */

import { getBillingProvider } from '../utils/geo-router';

export interface UsageRecord {
  userId: string;
  taskId: string;
  service: string;
  amount: number;
  currency: string;
  timestamp: number;
}

export interface BillingResult {
  success: boolean;
  provider: 'paddle' | 'stripe';
  transactionId?: string;
  error?: string;
}

/**
 * Routes billing request to appropriate provider based on country
 */
export async function routeBillingRequest(
  countryCode: string,
  usage: UsageRecord,
  env: {
    PADDLE_API_KEY?: string;
    STRIPE_SECRET_KEY?: string;
  }
): Promise<BillingResult> {
  const provider = getBillingProvider(countryCode);
  
  if (provider === 'paddle') {
    const { recordPaddleUsage } = await import('./paddle');
    return recordPaddleUsage(usage, env.PADDLE_API_KEY || '');
  } else {
    const { recordStripeUsage } = await import('./stripe');
    return recordStripeUsage(usage, env.STRIPE_SECRET_KEY || '');
  }
}

/**
 * Records usage for billing purposes
 */
export async function recordUsage(
  userId: string,
  taskId: string,
  service: string,
  countryCode: string,
  db: D1Database,
  env: {
    PADDLE_API_KEY?: string;
    STRIPE_SECRET_KEY?: string;
  }
): Promise<BillingResult> {
  // Task pricing: $0.05 per task
  const amount = 0.05;
  const currency = 'USD';
  
  // Store usage in database
  await db
    .prepare(
      `INSERT INTO usage (user_id, task_id, service, amount, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, taskId, service, amount, currency, Math.floor(Date.now() / 1000))
    .run();
  
  // Route to appropriate billing provider
  const usage: UsageRecord = {
    userId,
    taskId,
    service,
    amount,
    currency,
    timestamp: Date.now(),
  };
  
  return routeBillingRequest(countryCode, usage, env);
}

/**
 * Gets billing summary for a user
 */
export async function getBillingSummary(
  userId: string,
  startDate: Date,
  endDate: Date,
  db: D1Database
): Promise<{
  totalTasks: number;
  totalAmount: number;
  currency: string;
  breakdown: Record<string, number>;
}> {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);
  
  const results = await db
    .prepare(
      `SELECT service, COUNT(*) as count, SUM(amount) as total
       FROM usage
       WHERE user_id = ? AND created_at BETWEEN ? AND ?
       GROUP BY service`
    )
    .bind(userId, startTimestamp, endTimestamp)
    .all();
  
  const breakdown: Record<string, number> = {};
  let totalTasks = 0;
  let totalAmount = 0;
  
  for (const row of results.results || []) {
    const r = row as any;
    breakdown[r.service] = r.count;
    totalTasks += r.count;
    totalAmount += r.total;
  }
  
  return {
    totalTasks,
    totalAmount,
    currency: 'USD',
    breakdown,
  };
}
