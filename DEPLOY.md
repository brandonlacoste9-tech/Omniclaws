# Omniclaws Deploy Guide

Run these commands **in your terminal** (not via Cursor's non-interactive shell).

## 1. Navigate & Install

```bash
cd Omniclaws
npm install
```

## 2. Login to Cloudflare

```bash
npx wrangler login
```

Opens browser for OAuth. Complete the flow.

## 3. Create Resources

```bash
# D1 database (copy the database_id from output)
npx wrangler d1 create omniclaws-db

# R2 bucket for audit logs
npx wrangler r2 bucket create omniclaws-audit-logs
```

## 4. Update wrangler.toml

Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

with the `database_id` from step 3.

## 5. Run Migrations

```bash
# Test locally first
npm run db:migrate:local

# Production (after wrangler.toml is updated)
npm run db:migrate
```

## 6. Set Secrets

Run each command and paste the value when prompted:

```bash
npx wrangler secret put PADDLE_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put OPENCLAW_API_KEY
```

Optional:

```bash
npx wrangler secret put ALCHEMY_API_KEY
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ZYEUTE_API_KEY
npx wrangler secret put WHALE_API_KEY
```

## 7. Deploy

```bash
npm run deploy
```

Copy the Worker URL from the output (e.g. `https://omniclaws.<account>.workers.dev`).

## 8. Test First Charge

```bash
# Replace YOUR_WORKER_URL with your deploy URL
curl -X POST https://YOUR_WORKER_URL/openclaw/execute \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-1","payload":{"url":"example.com"}}'
```

**Expected:** `{"success":true,"taskId":"...","cost":0.05}`

> Note: OpenClaw doesn't require API key for execute. Billing uses `userId`; customer is auto-created on first charge.

## 9. Check Dashboard

```bash
curl https://YOUR_WORKER_URL/admin/metrics \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

When `revenue.last24h > 0`, Omniclaws is live.

## Alternative: CI/CD with API Token

For non-interactive deploys (e.g. GitHub Actions):

1. Create token at https://dash.cloudflare.com/profile/api-tokens
2. Permissions: Account › D1, Workers Scripts, R2
3. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` env vars
4. Run `npm run db:migrate` then `npm run deploy`
