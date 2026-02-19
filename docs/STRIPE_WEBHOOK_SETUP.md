# Stripe Webhook Setup

Omniclaws uses Stripe Checkout for credit pack purchases. Configure the webhook so credits are added when payment succeeds.

## 1. Create Webhook in Stripe Dashboard

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. **Endpoint URL**: `https://omniclaws.brandonlacoste9.workers.dev/billing/webhook`
4. **Events to send**: Select `checkout.session.completed`
5. Click **Add endpoint**

## 2. Get the Signing Secret

After creating the webhook, Stripe shows a **Signing secret** (starts with `whsec_`). Copy it.

## 3. Set the Secret in Wrangler

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Paste the signing secret when prompted.

## 4. Verify

- **Credit packs**: When a user completes checkout for a credit pack (Starter $5, Pro $10, Whale $50), the webhook receives `checkout.session.completed` with `metadata.type = "credit_pack"`. Credits are added to `user_credits` and the purchase is recorded in `credit_purchases`.
- **Usage-based billing**: For non–credit-pack checkouts, the webhook processes `usage_ledger` reservations as before.

## Webhook Payload (Credit Pack)

The checkout session metadata for credit packs:

```json
{
  "metadata": {
    "userId": "user-123",
    "type": "credit_pack",
    "packType": "starter",
    "credits": "5"
  }
}
```

## Troubleshooting

- **400 Invalid signature**: Ensure `STRIPE_WEBHOOK_SECRET` matches the webhook’s signing secret.
- **Credits not added**: Check Stripe Dashboard → Webhooks → [your endpoint] → Recent deliveries for the raw payload and response.
