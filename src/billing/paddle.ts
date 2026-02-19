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
