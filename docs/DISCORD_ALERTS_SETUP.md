# Discord Alerts Setup

Get 24/7 notifications when system health degrades.

## 1. Create Discord Webhook

1. Open your Discord server
2. Server Settings → Integrations → Webhooks
3. Click **New Webhook**
4. Name it (e.g. "Omniclaws Alerts")
5. Copy the **Webhook URL**

## 2. Set the Secret

```powershell
npx wrangler secret put DISCORD_WEBHOOK_URL
```

Paste the webhook URL when prompted.

## 3. What You'll Receive

The cron runs every 2 minutes. You'll get Discord embeds when:

- **Critical**: Task failure rate >5%, circuit breaker open, human review queue >100
- **Warning**: Revenue drought during business hours

## 4. Test

After setting the secret, deploy. Alerts will fire automatically when thresholds are exceeded.
