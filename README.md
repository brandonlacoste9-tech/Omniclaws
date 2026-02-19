# Omniclaws

Global edge-based AI monetization platform running 24/7 on Cloudflare Workers (200+ edge locations).

## Architecture

- **Runtime**: Cloudflare Workers (TypeScript), compatibility_date 2024-02-19
- **Billing**: Geo-routed — Paddle (EU/UK MoR) / Stripe (US/CA)
- **Compliance**: EU AI Act Article 6 for recruitment AI, GDPR data residency
- **Storage**: D1 (SQLite) for queues, R2 for immutable audit logs
- **Self-healing**: 3x retry with exponential backoff, cron reprocessing every 5 min

## Setup

```bash
npm install
```

### 1. Create D1 database

```bash
npx wrangler d1 create omniclaws-db
```

Copy the `database_id` from output and update `wrangler.toml`.

### 2. Create R2 bucket

```bash
npx wrangler r2 bucket create omniclaws-audit-logs
```

### 3. Run migrations

```bash
npm run db:migrate:local   # Local dev
npm run db:migrate        # Production
```

### 4. Set secrets (required)

```bash
wrangler secret put PADDLE_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET   # For credit pack webhook
wrangler secret put OPENCLAW_API_KEY
wrangler secret put ADMIN_API_KEY
```

Optional: `DISCORD_WEBHOOK_URL` (alerts), `ZYEUTE_API_KEY` (scrape), `ENVIRONMENT` (production/staging)

### 5. Stripe webhook (credit pack purchases)

Configure Stripe to send `checkout.session.completed` to `https://<your-worker>.workers.dev/billing/webhook`. See [docs/STRIPE_WEBHOOK_SETUP.md](docs/STRIPE_WEBHOOK_SETUP.md).

### 6. Local development

```bash
cp .dev.vars.example .dev.vars   # Add your keys
npm run dev
```

## API

### POST /api/task

Execute an AI task. Body:

```json
{
  "service": "openclaw" | "q-emplois" | "zyeute-content",
  "tenantId": "tenant-123",
  "payload": { ... }
}
```

- **q-emplois**: Recruitment AI (high-risk). EU AI Act: risk assessment, R2 audit log, human review if confidence < 0.95
- **openclaw**: Task execution engine
- **zyeute-content**: Content arbitrage bot

### GET /health

Health check (cached 60s at edge).

### WhaleWatcher (blockchain monitoring, $0.10/alert)

- **POST /whales/subscribe** — Create subscription. Body: `{ userId, chain: 'btc'|'eth', minValueUsd?, webhookUrl?, email? }`
- **GET /whales/alerts** — Historical alerts. Query: `?chain=&minValue=&since=&limit=`
- MVP simulation mode until `ALCHEMY_API_KEY` added. Rate limit: 100 alerts/user/hour.

### Admin (require `Authorization: Bearer ${ADMIN_API_KEY}`)

- **GET /admin/metrics** — Dashboard metrics (revenue, tasks, compliance, billing)
- **GET /admin/health** — Deep health (D1, R2, Paddle, Stripe)
- **GET /admin/realtime** — Current minute task count and revenue

## Billing

- **$0.05/task** (5 cents)
- **EU/UK** → Paddle (MoR handles VAT)
- **US/CA** → Stripe usage-based
- Geo-routing via `cf-ipcountry` header

## Compliance

- **EU AI Act Article 6**: Recruitment AI risk assessment, rationale logging, human-in-the-loop when confidence < 0.95
- **GDPR**: Data residency validation for EU requests
- **Audit**: Immutable logs to R2 (`audit/YYYY/MM/DD/...`)

## Monitoring

- **Cron every 2 min**: Health check, Discord alerts (failure rate >5%, revenue drought, human review queue >100, circuit breaker)
- **Analytics**: `analytics_events` table for ML optimization, `getTopCustomers`, `getChurnRisk`

## File Structure

```
src/
├── index.ts              # Main Worker, routes, cron
├── admin/
│   └── dashboard.ts      # Metrics, realtime stream, deep health
├── billing/
│   ├── router.ts         # Geo routing Paddle/Stripe
│   ├── paddle.ts         # EU/UK MoR
│   ├── stripe.ts         # US/CA
│   └── usage-meter.ts    # Reserve/confirm/flush
├── compliance/
│   ├── eu-ai-act.ts      # High-risk AI checks
│   ├── gdpr.ts           # Data residency
│   └── audit-logger.ts   # R2 immutable logging
├── monitoring/
│   ├── alerter.ts        # Health checks, Discord webhook
│   └── analytics.ts     # Event tracking, top customers, churn
├── services/
│   ├── openclaw-api.ts
│   ├── q-emplois.ts      # Recruitment AI (high risk)
│   └── zyeute-content.ts
└── utils/
    ├── geo-router.ts     # cf-ipcountry routing
    └── failover.ts       # Retry, circuit breakers
```
