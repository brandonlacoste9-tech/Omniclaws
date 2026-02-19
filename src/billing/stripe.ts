// Stripe payment provider for US/CA (usage-based metering)
import type { Env, PaymentProvider } from '../types';
import { AuditLogger } from '../compliance/audit-logger';

/**
 * Stripe integration for US/CA payments
 * Supports usage-based metering for per-task billing
 * Requires STRIPE_SECRET_KEY environment variable
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private apiKey: string;
  private auditLogger: AuditLogger;

  constructor(env: Env) {
    this.apiKey = env.STRIPE_SECRET_KEY;
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);

    if (!this.apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
  }

  /**
   * Process a one-time payment via Stripe
   */
  async processPayment(
    userId: string,
    amount: number,
    currency: string
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    try {
      // Create Stripe PaymentIntent
      const formData = new URLSearchParams({
        amount: Math.round(amount * 100).toString(), // Convert to cents
        currency: currency.toLowerCase(),
        customer: userId,
        'metadata[user_id]': userId
      });

      const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe payment failed:', error);
        return {
          success: false,
          error: `Stripe API error: ${response.status}`
        };
      }

      const data = await response.json() as { id: string };
      const transactionId = data.id;

      // Log transaction to audit trail
      await this.auditLogger.logTransaction(
        userId,
        transactionId,
        'stripe',
        amount,
        currency
      );

      return {
        success: true,
        transactionId
      };
    } catch (error) {
      console.error('Stripe payment error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create a subscription with usage-based metering
   */
  async createSubscription(
    userId: string,
    tier: string
  ): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
    try {
      // Map subscription tiers to Stripe price IDs (configure in Stripe dashboard)
      const priceIds: Record<string, string> = {
        'pro': 'price_pro_monthly',
        'enterprise': 'price_enterprise_monthly'
      };

      const priceId = priceIds[tier];
      if (!priceId) {
        return {
          success: false,
          error: `Invalid subscription tier: ${tier}`
        };
      }

      const formData = new URLSearchParams({
        customer: userId,
        'items[0][price]': priceId
      });

      const response = await fetch('https://api.stripe.com/v1/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe subscription failed:', error);
        return {
          success: false,
          error: `Stripe API error: ${response.status}`
        };
      }

      const data = await response.json() as { id: string };
      const subscriptionId = data.id;

      return {
        success: true,
        subscriptionId
      };
    } catch (error) {
      console.error('Stripe subscription error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Report usage for metered billing
   */
  async reportUsage(
    subscriptionItemId: string,
    quantity: number,
    timestamp?: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const formData = new URLSearchParams({
        quantity: quantity.toString(),
        timestamp: timestamp ? timestamp.toString() : Math.floor(Date.now() / 1000).toString(),
        action: 'increment'
      });

      const response = await fetch(
        `https://api.stripe.com/v1/subscription_items/${subscriptionItemId}/usage_records`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe usage reporting failed:', error);
        return {
          success: false,
          error: `Stripe API error: ${response.status}`
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Stripe usage reporting error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(request: Request): Promise<Response> {
    try {
      const payload = await request.json();
      
      // Verify webhook signature (implement based on Stripe's webhook verification)
      // const signature = request.headers.get('stripe-signature');
      
      // Process different event types
      switch (payload.type) {
        case 'payment_intent.succeeded':
          // Handle successful payment
          console.log('Payment succeeded:', payload.data.object.id);
          break;
        case 'customer.subscription.created':
          // Handle new subscription
          console.log('Subscription created:', payload.data.object.id);
          break;
        case 'customer.subscription.deleted':
          // Handle subscription cancellation
          console.log('Subscription cancelled:', payload.data.object.id);
          break;
        default:
          console.log('Unhandled webhook event:', payload.type);
      }

      return new Response('Webhook processed', { status: 200 });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return new Response('Webhook processing failed', { status: 500 });
    }
  }
}
