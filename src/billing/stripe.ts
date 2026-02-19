/**
 * Stripe Integration: US/CA usage-based billing
 * Documentation: https://stripe.com/docs/api
 */

import type { UsageRecord, BillingResult } from './router';

/**
 * Records usage event to Stripe for US/CA customers
 */
export async function recordStripeUsage(
  usage: UsageRecord,
  secretKey: string // Environment variable: STRIPE_SECRET_KEY
): Promise<BillingResult> {
  if (!secretKey) {
    return {
      success: false,
      provider: 'stripe',
      error: 'STRIPE_SECRET_KEY not configured',
    };
  }
  
  try {
    // Create a usage record in Stripe
    // This assumes the customer has an active subscription with metered billing
    const response = await fetch('https://api.stripe.com/v1/usage_records', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        quantity: '1', // 1 task
        timestamp: String(Math.floor(usage.timestamp / 1000)),
        action: 'increment',
      }).toString(),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Stripe API error:', error);
      return {
        success: false,
        provider: 'stripe',
        error: `Stripe API error: ${response.status}`,
      };
    }
    
    const result = await response.json();
    
    return {
      success: true,
      provider: 'stripe',
      transactionId: result.id || usage.taskId,
    };
  } catch (error) {
    console.error('Stripe billing error:', error);
    return {
      success: false,
      provider: 'stripe',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Creates a Stripe customer for US/CA users
 */
export async function createStripeCustomer(
  email: string,
  countryCode: string,
  secretKey: string // Environment variable: STRIPE_SECRET_KEY
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  if (!secretKey) {
    return {
      success: false,
      error: 'STRIPE_SECRET_KEY not configured',
    };
  }
  
  try {
    const response = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email,
        metadata: JSON.stringify({ country: countryCode }),
      }).toString(),
    });
    
    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Failed to create Stripe customer: ${response.status}`,
      };
    }
    
    const result = await response.json();
    
    return {
      success: true,
      customerId: result.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Creates a usage-based subscription for a customer
 */
export async function createUsageSubscription(
  customerId: string,
  priceId: string,
  secretKey: string // Environment variable: STRIPE_SECRET_KEY
): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
  if (!secretKey) {
    return {
      success: false,
      error: 'STRIPE_SECRET_KEY not configured',
    };
  }
  
  try {
    const response = await fetch('https://api.stripe.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId,
        items: JSON.stringify([{ price: priceId }]),
      }).toString(),
    });
    
    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Failed to create subscription: ${response.status}`,
      };
    }
    
    const result = await response.json();
    
    return {
      success: true,
      subscriptionId: result.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Gets Stripe pricing for display
 */
export async function getStripePricing(): Promise<{
  success: boolean;
  pricePerTask?: number;
  currency?: string;
  error?: string;
}> {
  // Base price is $0.05 per task for US/CA
  return {
    success: true,
    pricePerTask: 0.05,
    currency: 'USD',
  };
}
