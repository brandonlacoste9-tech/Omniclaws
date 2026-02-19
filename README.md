# Omniclaws

Omniclaws is a distributed automation platform that turns AI agents into revenue streams. It runs on Cloudflare's edge network, handles global payments (Paddle/Stripe), and maintains compliance with EU AI Act — all while you sleep. From automated recruitment to content arbitrage, it claws profit from every timezone simultaneously.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create omniclaws_db

# Update wrangler.toml with your database ID

# Run migrations
wrangler d1 execute omniclaws_db --file=schema.sql

# Create R2 bucket
wrangler r2 bucket create omniclaws-audit-logs

# Set environment variables
wrangler secret put PADDLE_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put NEVERMINED_API_KEY

# Deploy to Cloudflare
npm run deploy
```

## 📚 Documentation

- [Complete Setup Guide](SETUP.md) - Step-by-step installation instructions
- [Environment Variables](ENV_VARS.md) - All required API keys and configuration

## 🏗️ Architecture

### Core Services

1. **OpenClaw API** (`src/services/openclaw-api.ts`)
   - Task execution engine for automation jobs
   - Supports scraping, form filling, and scheduling
   - Pricing: $0.05 per task

2. **Q-Emplois** (`src/services/q-emplois.ts`)
   - Recruitment AI system
   - EU AI Act "high-risk" classification
   - Requires human-in-the-loop for confidence < 0.95
   - Full audit trails and CE marking compliance

3. **Zyeuté Content** (`src/services/zyeute-content.ts`)
   - Automated content arbitrage bot
   - Scrapes RSS feeds, summarizes with AI
   - Injects affiliate links automatically

### Billing Infrastructure (`src/billing/`)

- **Smart Geo-Router** - Directs EU/UK to Paddle, US/CA to Stripe
- **Paddle Integration** - Merchant of Record handling VAT
- **Stripe Integration** - Usage-based metering for per-task billing
- **Nevermined** - Micro-transaction tracking

### Compliance Layer (`src/compliance/`)

- **EU AI Act Monitor** - Article 6 compliance for high-risk AI
- **GDPR Enforcement** - Data residency (EU data stays in EU)
- **Audit Logger** - Immutable logs to R2 for conformity assessments
- **Human Oversight Queue** - Review system for low-confidence AI decisions

### Technical Stack

- **Runtime**: Cloudflare Workers with TypeScript (strict mode)
- **Database**: D1 SQLite for task queues and user management
- **Storage**: R2 for compliance logs (append-only)
- **Edge**: Global distribution with <50ms response times
- **Resilience**: Circuit breakers, exponential backoff, automatic retries

## 🔧 Development

```bash
# Start local development server
npm run dev

# TypeScript compilation
npm run build

# Run linter
npm run lint

# Format code
npm run format
```

## 📊 API Endpoints

### User Registration
```bash
POST /api/users/register
{
  "email": "user@example.com"
}
```

### OpenClaw API
```bash
POST /api/openclaw/tasks
{
  "userId": "user-id",
  "taskType": "scraping",
  "payload": { "url": "https://example.com" }
}
```

### Q-Emplois (High-Risk AI)
```bash
POST /api/q-emplois/tasks
{
  "userId": "user-id",
  "taskType": "candidate_screening",
  "payload": { "resume": "...", "requirements": [...] }
}

GET /api/q-emplois/oversight

POST /api/q-emplois/oversight/review
{
  "oversightId": "id",
  "reviewerId": "reviewer-id",
  "decision": "approved",
  "reasoning": "..."
}
```

### Zyeuté Content
```bash
POST /api/zyeute/workflow
{
  "userId": "user-id",
  "feedUrl": "https://example.com/feed.xml",
  "affiliateLinks": [
    { "keyword": "product", "url": "https://affiliate.com/ref" }
  ]
}
```

### Billing
```bash
POST /api/billing/payment
{
  "userId": "user-id",
  "amount": 10.00,
  "currency": "USD"
}

POST /api/billing/subscription
{
  "userId": "user-id",
  "tier": "pro"
}
```

## 🛡️ Security & Compliance

- All API keys stored as Cloudflare secrets
- EU AI Act Article 6 compliance for high-risk systems
- GDPR data residency enforcement
- Immutable audit logs in R2
- Human oversight for AI decisions below confidence threshold

## 🔄 Self-Healing

- **Circuit Breakers** - Prevent cascading failures
- **Exponential Backoff** - Automatic retry with jitter
- **Failed Task Queue** - Cron job reprocesses every 5 minutes
- **Rate Limiting** - Token bucket algorithm

## 📈 Monitoring

- Cloudflare Analytics dashboard
- Audit logs in R2 bucket
- Task queue status in D1
- Payment transactions tracking

## 🌍 Global Edge Network

Deployed across Cloudflare's global edge network for:
- Sub-50ms response times worldwide
- Automatic geo-routing for payments
- GDPR-compliant data residency
- 99.99% uptime SLA

## 📝 License

See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## 📞 Support

For issues or questions, please open an issue on GitHub.
