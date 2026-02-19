/**
 * Stripe US/Canada billing
 * env.STRIPE_SECRET_KEY required - set via wrangler secret put STRIPE_SECRET_KEY
 * Use test mode keys (sk_test_*) for development
 */

const STRIPE_API_URL = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 15000;

export interface StripeChargeResult {
  success: boolean;
  chargeId?: string;
  status?: "succeeded" | "requires_confirmation" | "requires_action";
  error?: string;
}

export interface StripeCustomerResult {
  success: boolean;
  customerId?: string;
  error?: string;
}

/**
 * Charge customer via Stripe PaymentIntent API.
 * Uses form-urlencoded as per Stripe API spec.
 */
export async function chargeStripe(
  customerId: string,
  amountCents: number,
  currency: string,
  secretKey: string
): Promise<StripeChargeResult> {
  if (!secretKey) {
    return { success: false, error: "STRIPE_SECRET_KEY not configured" };
  }

  const params = new URLSearchParams({
    amount: String(amountCents),
    currency: currency.toLowerCase(),
    customer: customerId,
    "automatic_payment_methods[enabled]": "true",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${STRIPE_API_URL}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = (await response.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };

    if (data.error) {
      return { success: false, error: data.error.message ?? "Stripe error" };
    }

    if (!response.ok) {
      return { success: false, error: `Stripe API ${response.status}` };
    }

    const status = data.status as string | undefined;
    if (status === "requires_payment_method" || status === "requires_action") {
      return {
        success: true,
        chargeId: data.id,
        status: "requires_confirmation",
      };
    }

    return {
      success: status === "succeeded",
      chargeId: data.id,
      status: status as "succeeded" | "requires_confirmation",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Create Stripe customer for storage in D1.
 */
export async function createStripeCustomer(
  email: string,
  secretKey: string
): Promise<StripeCustomerResult> {
  if (!secretKey) {
    return { success: false, error: "STRIPE_SECRET_KEY not configured" };
  }

  const params = new URLSearchParams({
    email,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${STRIPE_API_URL}/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (data.error) {
      return { success: false, error: data.error.message ?? "Stripe error" };
    }

    if (!response.ok) {
      return { success: false, error: `Stripe API ${response.status}` };
    }

    return {
      success: true,
      customerId: data.id,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
