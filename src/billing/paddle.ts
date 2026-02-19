/**
 * Paddle Integration: EU/UK billing with Merchant of Record (handles VAT automatically)
 * Documentation: https://developer.paddle.com/api-reference
 */

import type { UsageRecord, BillingResult } from './router';

/**
 * Records usage event to Paddle for EU/UK customers
 * Paddle acts as Merchant of Record and handles VAT compliance
 */
export async function recordPaddleUsage(
  usage: UsageRecord,
  apiKey: string // Environment variable: PADDLE_API_KEY
): Promise<BillingResult> {
  if (!apiKey) {
    return {
      success: false,
      provider: 'paddle',
      error: 'PADDLE_API_KEY not configured',
    };
  }
  
  try {
    // Paddle API endpoint for usage-based billing
    const response = await fetch('https://api.paddle.com/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'usage_event',
        data: {
          customer_id: usage.userId,
          event_name: 'task_execution',
          properties: {
            task_id: usage.taskId,
            service: usage.service,
            amount: usage.amount,
            currency: usage.currency,
          },
          timestamp: new Date(usage.timestamp).toISOString(),
        },
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Paddle API error:', errorText);
      return {
        success: false,
        provider: 'paddle',
        error: `Paddle API error: ${response.status}`,
      };
    }
    
    const result = await response.json() as any;
    
    return {
      success: true,
      provider: 'paddle',
      transactionId: result.data?.id || usage.taskId,
    };
  } catch (error) {
    console.error('Paddle billing error:', error);
    return {
      success: false,
      provider: 'paddle',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Creates a Paddle customer for EU/UK users
 */
export async function createPaddleCustomer(
  email: string,
  countryCode: string,
  apiKey: string // Environment variable: PADDLE_API_KEY
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  if (!apiKey) {
    return {
      success: false,
      error: 'PADDLE_API_KEY not configured',
    };
  }
  
  try {
    const response = await fetch('https://api.paddle.com/customers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        locale: countryCode.toLowerCase(),
        address: {
          country_code: countryCode,
        },
      }),
    });
    
    if (!response.ok) {
      await response.text();
      return {
        success: false,
        error: `Failed to create Paddle customer: ${response.status}`,
      };
    }
    
    const result = await response.json() as any;
    
    return {
      success: true,
      customerId: result.data?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Gets Paddle pricing for display (includes VAT where applicable)
 */
export async function getPaddlePricing(
  countryCode: string
): Promise<{
  success: boolean;
  pricePerTask?: number;
  currency?: string;
  includesVAT?: boolean;
  error?: string;
}> {
  // Base price is $0.05 per task
  // Paddle automatically calculates and adds VAT for EU countries
  const basePrice = 0.05;
  const currency = 'USD';
  
  // EU countries have VAT added by Paddle (typically 15-25%)
  const euCountries = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
  
  const includesVAT = euCountries.has(countryCode) || countryCode === 'GB';
  
  return {
    success: true,
    pricePerTask: basePrice,
    currency,
    includesVAT,
  };
}
