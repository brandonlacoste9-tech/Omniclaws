import { PaddleProvider } from './paddle';
import { StripeProvider } from './stripe';
import { getPaymentProvider } from '../utils/geo-router';
/**
 * Smart geo-router that directs traffic to appropriate payment provider
 * - EU/UK -> Paddle (Merchant of Record handling VAT)
 * - US/CA -> Stripe (usage-based metering)
 */
export class BillingRouter {
    constructor(env) {
        this.paddle = new PaddleProvider(env);
        this.stripe = new StripeProvider(env);
        this.db = env.DB;
    }
    /**
     * Get the appropriate payment provider for a user
     */
    getProvider(region) {
        const providerName = getPaymentProvider(region);
        return providerName === 'paddle' ? this.paddle : this.stripe;
    }
    /**
     * Process a payment for a user
     */
    async processPayment(userId, amount, currency) {
        try {
            // Get user to determine region
            const user = await this.db
                .prepare('SELECT * FROM users WHERE id = ?')
                .bind(userId)
                .first();
            if (!user) {
                return new Response(JSON.stringify({ error: 'User not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // Get appropriate provider based on region
            const provider = this.getProvider(user.region);
            // Process payment
            const result = await provider.processPayment(userId, amount, currency);
            if (!result.success) {
                return new Response(JSON.stringify({ error: result.error }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // Record transaction in database
            await this.db
                .prepare(`INSERT INTO transactions 
          (id, user_id, provider, amount, currency, status, provider_transaction_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(crypto.randomUUID(), userId, provider.name, amount, currency, 'completed', result.transactionId, Date.now())
                .run();
            return new Response(JSON.stringify({
                success: true,
                transactionId: result.transactionId,
                provider: provider.name
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        catch (error) {
            console.error('Payment processing error:', error);
            return new Response(JSON.stringify({
                error: 'Payment processing failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
    /**
     * Create a subscription for a user
     */
    async createSubscription(userId, tier) {
        try {
            // Get user to determine region
            const user = await this.db
                .prepare('SELECT * FROM users WHERE id = ?')
                .bind(userId)
                .first();
            if (!user) {
                return new Response(JSON.stringify({ error: 'User not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // Get appropriate provider based on region
            const provider = this.getProvider(user.region);
            // Create subscription
            const result = await provider.createSubscription(userId, tier);
            if (!result.success) {
                return new Response(JSON.stringify({ error: result.error }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // Update user subscription tier
            await this.db
                .prepare('UPDATE users SET subscription_tier = ?, payment_provider = ? WHERE id = ?')
                .bind(tier, provider.name, userId)
                .run();
            return new Response(JSON.stringify({
                success: true,
                subscriptionId: result.subscriptionId,
                provider: provider.name
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        catch (error) {
            console.error('Subscription creation error:', error);
            return new Response(JSON.stringify({
                error: 'Subscription creation failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
    /**
     * Record usage for billing (per-task pricing)
     */
    async recordUsage(userId, service, taskId, amount) {
        await this.db
            .prepare(`INSERT INTO usage (id, user_id, service, task_id, amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), userId, service, taskId, amount, Date.now())
            .run();
    }
    /**
     * Handle webhook from payment providers
     */
    async handleWebhook(request) {
        const url = new URL(request.url);
        const provider = url.pathname.includes('paddle') ? 'paddle' : 'stripe';
        if (provider === 'paddle') {
            return await this.paddle.handleWebhook(request);
        }
        else {
            return await this.stripe.handleWebhook(request);
        }
    }
}
