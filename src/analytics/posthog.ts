import type { Env } from '../types';

/**
 * PostHog Analytics Integration
 * Tracks: signups, task execution, credit purchases, funnel events
 */

const POSTHOG_HOST = 'https://us.i.posthog.com';

interface PostHogEvent {
  event: string;
  distinct_id: string;
  properties?: Record<string, any>;
  timestamp?: string;
}

export class PostHogAnalytics {
  private apiKey: string;
  private env: Env;

  constructor(env: Env) {
    this.apiKey = env.POSTHOG_API_KEY || '';
    this.env = env;
  }

  private isEnabled(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Capture an event to PostHog
   */
  async capture(event: PostHogEvent): Promise<void> {
    if (!this.isEnabled()) {
      console.log('[PostHog] Skipping event (no API key):', event.event);
      return;
    }

    try {
      const payload = {
        api_key: this.apiKey,
        event: event.event,
        distinct_id: event.distinct_id,
        properties: {
          ...event.properties,
          $lib: 'omniclaws-worker',
          $lib_version: '1.0.0',
          environment: this.env.ENVIRONMENT || 'development',
        },
        timestamp: event.timestamp || new Date().toISOString(),
      };

      const response = await fetch(`${POSTHOG_HOST}/capture/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('[PostHog] Capture failed:', await response.text());
      } else {
        console.log('[PostHog] Event captured:', event.event);
      }
    } catch (err) {
      console.error('[PostHog] Capture error:', err);
      // Don't throw - analytics should never break the app
    }
  }

  /**
   * Identify a user with traits
   */
  async identify(distinctId: string, traits: Record<string, any>): Promise<void> {
    if (!this.isEnabled()) return;

    await this.capture({
      event: '$identify',
      distinct_id: distinctId,
      properties: {
        $set: traits,
      },
    });
  }

  // ===== Pre-built Event Helpers =====

  /**
   * Track user signup
   */
  async trackSignup(userId: string, props: {
    email: string;
    region: string;
    attribution?: string;
    plan?: string;
  }): Promise<void> {
    await this.capture({
      event: 'user_signed_up',
      distinct_id: userId,
      properties: {
        ...props,
        signup_date: new Date().toISOString(),
      },
    });

    // Also set user properties
    await this.identify(userId, {
      email: props.email,
      region: props.region,
      plan: props.plan || 'free',
      signup_date: new Date().toISOString(),
    });
  }

  /**
   * Track task execution
   */
  async trackTaskExecuted(userId: string, props: {
    service: string;
    tier: 'free' | 'paid';
    cost: number;
    duration_ms?: number;
    success: boolean;
    error_type?: string;
  }): Promise<void> {
    await this.capture({
      event: 'task_executed',
      distinct_id: userId,
      properties: props,
    });
  }

  /**
   * Track credit purchase
   */
  async trackCreditsPurchased(userId: string, props: {
    amount: number;
    revenue: number;
    currency: string;
    payment_provider: 'stripe' | 'paddle';
    package_type: string;
  }): Promise<void> {
    await this.capture({
      event: 'credits_purchased',
      distinct_id: userId,
      properties: {
        ...props,
        $revenue: props.revenue,
        $currency: props.currency,
      },
    });
  }

  /**
   * Track credit usage (for funnel analysis)
   */
  async trackCreditsUsed(userId: string, props: {
    remaining: number;
    used: number;
    threshold: 'normal' | 'low' | 'critical';
  }): Promise<void> {
    await this.capture({
      event: 'credits_used',
      distinct_id: userId,
      properties: props,
    });
  }

  /**
   * Track page/view events
   */
  async trackPageView(userId: string, props: {
    page: string;
    referrer?: string;
    utm_source?: string;
    utm_campaign?: string;
  }): Promise<void> {
    await this.capture({
      event: '$pageview',
      distinct_id: userId,
      properties: props,
    });
  }

  /**
   * Track feature usage
   */
  async trackFeatureUsed(userId: string, feature: string, props?: Record<string, any>): Promise<void> {
    await this.capture({
      event: 'feature_used',
      distinct_id: userId,
      properties: {
        feature,
        ...props,
      },
    });
  }
}

// Singleton getter for use in handlers
export function getAnalytics(env: Env): PostHogAnalytics {
  return new PostHogAnalytics(env);
}
