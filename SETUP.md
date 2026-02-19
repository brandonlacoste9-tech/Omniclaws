# Omniclaws Platform - Setup Guide

## Overview

Omniclaws is a distributed automation platform running on Cloudflare's edge network. It provides three core services with integrated billing and EU AI Act compliance.

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)

## Installation

1. **Clone the repository:**
```bash
git clone https://github.com/brandonlacoste9-tech/Omniclaws.git
cd Omniclaws
```

2. **Install dependencies:**
```bash
npm install
```

3. **Login to Cloudflare:**
```bash
wrangler login
```

## Database Setup

1. **Create D1 database:**
```bash
wrangler d1 create omniclaws_db
```

2. **Update `wrangler.toml` with your database ID** (copy from the output above)

3. **Run migrations:**
```bash
wrangler d1 execute omniclaws_db --file=schema.sql
```

## R2 Storage Setup

1. **Create R2 bucket for audit logs:**
```bash
wrangler r2 bucket create omniclaws-audit-logs
```

## Environment Variables

Set the following secrets using Wrangler:

```bash
# Paddle API Key (for EU/UK payments)
wrangler secret put PADDLE_API_KEY

# Stripe Secret Key (for US/CA payments)
wrangler secret put STRIPE_SECRET_KEY

# Nevermined API Key (for micro-transactions)
wrangler secret put NEVERMINED_API_KEY
```

### How to Get API Keys:

- **Paddle:** Sign up at https://paddle.com and get your API key from Settings > Developer Tools
- **Stripe:** Sign up at https://stripe.com and get your secret key from Developers > API keys
- **Nevermined:** Sign up at https://nevermined.io and get your API key from your dashboard

## Development

Run the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:8787`

## Deployment

Deploy to Cloudflare's edge network:
```bash
npm run deploy
```

## API Endpoints

### User Registration
```bash
POST /api/users/register
{
  "email": "user@example.com"
}
```

### OpenClaw API (Task Automation)
```bash
# Create task
POST /api/openclaw/tasks
{
  "userId": "user-id",
  "taskType": "scraping",  # or "form_filling", "scheduling"
  "payload": {
    "url": "https://example.com",
    "selectors": ["h1", "p"]
  }
}

# Get task status
GET /api/openclaw/tasks?taskId=task-id
```

### Q-Emplois (Recruitment AI - High-Risk)
```bash
# Create recruitment task
POST /api/q-emplois/tasks
{
  "userId": "user-id",
  "taskType": "candidate_screening",  # or "job_matching", "skill_assessment"
  "payload": {
    "resume": "...",
    "requirements": ["skill1", "skill2"]
  }
}

# Get pending human oversight items
GET /api/q-emplois/oversight

# Submit human review
POST /api/q-emplois/oversight/review
{
  "oversightId": "oversight-id",
  "reviewerId": "reviewer-id",
  "decision": "approved",  # or "rejected"
  "reasoning": "Meets all requirements"
}
```

### Zyeuté Content (Content Arbitrage)
```bash
# Create content task
POST /api/zyeute/tasks
{
  "userId": "user-id",
  "taskType": "rss_scrape",  # or "ai_summarize", "affiliate_inject"
  "payload": {
    "feedUrl": "https://example.com/feed.xml",
    "limit": 10
  }
}

# Run full arbitrage workflow
POST /api/zyeute/workflow
{
  "userId": "user-id",
  "feedUrl": "https://example.com/feed.xml",
  "affiliateLinks": [
    { "keyword": "product", "url": "https://affiliate.com/ref123" }
  ]
}
```

### Billing
```bash
# Process payment
POST /api/billing/payment
{
  "userId": "user-id",
  "amount": 10.00,
  "currency": "USD"
}

# Create subscription
POST /api/billing/subscription
{
  "userId": "user-id",
  "tier": "pro"  # or "enterprise"
}
```

## Architecture

### Services

1. **OpenClaw API** - Task execution engine ($0.05 per task)
2. **Q-Emplois** - Recruitment AI (EU AI Act high-risk compliance)
3. **Zyeuté Content** - Content arbitrage bot

### Billing

- **Paddle** - EU/UK payments (Merchant of Record)
- **Stripe** - US/CA payments (usage-based metering)
- Automatic geo-routing based on user location

### Compliance

- **EU AI Act Article 6** - High-risk AI monitoring
- **GDPR** - Data residency enforcement
- **Audit Logging** - Immutable logs in R2

### Self-Healing

- Circuit breakers for fault tolerance
- Exponential backoff retry logic
- Failed task queue with cron reprocessing (every 5 minutes)

## Cron Jobs

The platform automatically retries failed tasks every 5 minutes via Cloudflare Cron Triggers.

## Testing

```bash
npm test
```

## TypeScript

The project uses TypeScript in strict mode. Run type checking:
```bash
npm run build
```

## Monitoring

- Check Cloudflare dashboard for analytics
- View audit logs in R2 bucket
- Monitor task queue in D1 database

## Support

For issues or questions, please open an issue on GitHub.

## License

See LICENSE file for details.
