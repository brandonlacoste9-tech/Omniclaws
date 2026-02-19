// Paddle payment provider for EU/UK (Merchant of Record)
import type { Env, PaymentProvider } from '../types';
import { AuditLogger } from '../compliance/audit-logger';

/**
 * Paddle integration for EU/UK payments
 * Acts as Merchant of Record, handling VAT compliance
 * Requires PADDLE_API_KEY environment variable
 */
export class PaddleProvider implements PaymentProvider {
  readonly name = 'paddle' as const;
  private apiKey: string;
  private auditLogger: AuditLogger;

  constructor(env: Env) {
    this.apiKey = env.PADDLE_API_KEY;
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);

    if (!this.apiKey) {
      throw new Error('PADDLE_API_KEY environment variable is required');
    }
  }

  /**
   * Process a one-time payment via Paddle
   */
  async processPayment(
    userId: string,
    amount: number,
    currency: string
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    try {
      // Paddle API endpoint for payment creation
      const response = await fetch('https://api.paddle.com/transactions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: [{
            price: {
              amount: Math.round(amount * 100).toString(), // Convert to cents
              currency: currency.toUpperCase()
            },
            quantity: 1
          }],
          customer: {
            id: userId
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Paddle payment failed:', error);
        return {
          success: false,
          error: `Paddle API error: ${response.status}`
        };
      }

      const data = await response.json() as { data: { id: string } };
      const transactionId = data.data.id;

      // Log transaction to audit trail
      await this.auditLogger.logTransaction(
        userId,
        transactionId,
        'paddle',
        amount,
        currency
      );

      return {
        success: true,
        transactionId
      };
    } catch (error) {
      console.error('Paddle payment error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create a subscription via Paddle
   */
  async createSubscription(
    userId: string,
    tier: string
  ): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
    try {
      // Map subscription tiers to Paddle price IDs (configure in Paddle dashboard)
      const priceIds: Record<string, string> = {
        'pro': 'pri_01_pro_monthly',
        'enterprise': 'pri_01_enterprise_monthly'
      };

      const priceId = priceIds[tier];
      if (!priceId) {
        return {
          success: false,
          error: `Invalid subscription tier: ${tier}`
        };
      }

      const response = await fetch('https://api.paddle.com/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: [{
            price_id: priceId,
            quantity: 1
          }],
          customer: {
            id: userId
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Paddle subscription failed:', error);
        return {
          success: false,
          error: `Paddle API error: ${response.status}`
        };
      }

      const data = await response.json() as { data: { id: string } };
      const subscriptionId = data.data.id;

      return {
        success: true,
        subscriptionId
      };
    } catch (error) {
      console.error('Paddle subscription error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle Paddle webhook events
   */
  async handleWebhook(request: Request): Promise<Response> {
    try {
      const payload = await request.json();
      
      // Verify webhook signature (implement based on Paddle's webhook verification)
      // const signature = request.headers.get('paddle-signature');
      
      // Process different event types
      switch (payload.event_type) {
        case 'transaction.completed':
          // Handle successful payment
          console.log('Payment completed:', payload.data.id);
          break;
        case 'subscription.created':
          // Handle new subscription
          console.log('Subscription created:', payload.data.id);
          break;
        case 'subscription.cancelled':
          // Handle subscription cancellation
          console.log('Subscription cancelled:', payload.data.id);
          break;
        default:
          console.log('Unhandled webhook event:', payload.event_type);
      }

      return new Response('Webhook processed', { status: 200 });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return new Response('Webhook processing failed', { status: 500 });
    }
  }
}
