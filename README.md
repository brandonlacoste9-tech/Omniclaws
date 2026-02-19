# Omniclaws

**Global Edge-Based AI Monetization Platform**

Omniclaws is a distributed automation platform that turns AI agents into revenue streams. It runs on Cloudflare's edge network (200+ locations), handles global payments (Paddle/Stripe), and maintains compliance with EU AI Act — all while you sleep. From automated recruitment to content arbitrage, it claws profit from every timezone simultaneously.

## 🚀 Features

- **Global Edge Computing**: Runs on Cloudflare Workers in 200+ locations
- **Multi-Tenant Billing**: Geo-based routing (Paddle for EU/UK, Stripe for US/CA)
- **EU AI Act Compliant**: High-risk AI checks with human-in-the-loop for recruitment
- **Self-Healing**: Automatic retry with exponential backoff and circuit breakers
- **Immutable Audit Logs**: R2-backed compliance logging for regulatory requirements
- **Sub-50ms Latency**: Edge-optimized with Cloudflare cache
- **24/7 Operation**: Cron-triggered task reprocessing every 5 minutes

## 📁 Architecture

```
src/
├── index.ts                    # Main Worker entry point
├── billing/
│   ├── router.ts              # Geo-based payment routing
│   ├── paddle.ts              # EU/UK MoR integration
│   └── stripe.ts              # US/CA direct billing
├── compliance/
│   ├── eu-ai-act.ts           # High-risk AI checks
│   ├── gdpr.ts                # Data residency enforcement
│   └── audit-logger.ts        # R2 immutable logging
├── services/
│   ├── openclaw-api.ts        # Task execution engine
│   ├── q-emplois.ts           # Recruitment AI (high-risk)
│   └── zyeute-content.ts      # Content arbitrage bot
└── utils/
    ├── geo-router.ts          # Country-based routing
    └── failover.ts            # Circuit breakers & retry logic
```

## 🛠️ Setup

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers, D1, and R2 enabled
- Paddle account (for EU/UK)
- Stripe account (for US/CA)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/brandonlacoste9-tech/Omniclaws.git
cd Omniclaws
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure Wrangler**
```bash
wrangler login
```

4. **Create D1 Database**
```bash
wrangler d1 create omniclaws-db
```

Update `wrangler.toml` with the returned database ID.

5. **Run database migrations**
```bash
wrangler d1 execute omniclaws-db --file=./schema.sql
```

6. **Create R2 Buckets**
```bash
wrangler r2 bucket create omniclaws-audit-logs
wrangler r2 bucket create omniclaws-compliance
```

7. **Set environment variables**
```bash
# Copy example env file
cp .env.example .env

# Set secrets (never commit these!)
wrangler secret put PADDLE_API_KEY
wrangler secret put PADDLE_VENDOR_ID
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

## 🚀 Deployment

### Development
```bash
npm run dev
```

Visit http://localhost:8787 to test locally.

### Production
```bash
npm run deploy
```

## 📡 API Endpoints

### User Registration
```bash
POST /api/register
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "userId": "uuid",
  "apiKey": "omniclaw_...",
  "paymentProvider": "paddle|stripe",
  "customerId": "cus_..."
}
```

### Recruitment AI (HIGH-RISK - EU AI Act Article 6)
```bash
POST /api/recruitment
Authorization: Bearer omniclaw_...
Content-Type: application/json

{
  "jobDescription": "Senior Software Engineer",
  "candidateProfile": {
    "experience": "5 years",
    "skills": ["TypeScript", "React", "Node.js"]
  },
  "evaluationCriteria": ["technical skills", "experience"],
  "position": "Senior SWE"
}
```

**Response:**
```json
{
  "taskId": "uuid",
  "status": "pending_review|processing|completed",
  "requiresHumanReview": true,
  "score": 85.5,
  "recommendation": "Strong Match",
  "strengths": ["..."],
  "concerns": ["..."]
}
```

### Content Arbitrage
```bash
POST /api/content
Authorization: Bearer omniclaw_...
Content-Type: application/json

{
  "keywords": ["AI", "automation"],
  "sources": ["example.com", "news.site"],
  "filters": {
    "minQuality": 70,
    "language": "en"
  }
}
```

### Get Task Result
```bash
GET /api/recruitment/result?taskId=uuid
GET /api/content/result?taskId=uuid
Authorization: Bearer omniclaw_...
```

### Billing Summary
```bash
GET /api/billing/summary
Authorization: Bearer omniclaw_...
```

**Response:**
```json
{
  "provider": "paddle|stripe",
  "totalAmount": 12.50,
  "totalTasks": 250,
  "invoiced": false
}
```

### GDPR Compliance

**Export User Data**
```bash
GET /api/gdpr/export
Authorization: Bearer omniclaw_...
```

**Delete User Data (Right to be Forgotten)**
```bash
POST /api/gdpr/delete
Authorization: Bearer omniclaw_...
```

## 🔒 Security

- **API Keys**: Never commit API keys or secrets to version control
- **Environment Variables**: Use `wrangler secret put` for production secrets
- **Webhook Verification**: All webhooks verify cryptographic signatures
- **Audit Logging**: All actions logged to immutable R2 storage
- **EU AI Act**: High-risk AI requires human review if confidence < 0.95

## 💰 Pricing

- **Per-Task**: $0.05 per task (recruitment or content)
- **EU/UK**: Billed via Paddle (VAT handled automatically)
- **US/CA**: Billed via Stripe (usage-based metering)
- **Billing Cycle**: Monthly aggregation

## 📊 Monitoring

### Health Check
```bash
GET /
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-02-19T12:00:00Z",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "storage": "connected"
  }
}
```

### Cron Jobs
Failed tasks automatically reprocess every 5 minutes via Cloudflare Cron Triggers.

## 🇪🇺 EU AI Act Compliance

### High-Risk AI Systems (Article 6)
- **Recruitment AI** (`q-emplois`) is classified as high-risk
- Requires risk assessment before execution
- Human review triggered if confidence < 95%
- Decision rationale logged to R2 for 10 years
- Compliant with Articles 9, 12, 13, 14

### GDPR Compliance
- Data residency validation for EU users
- Right to access (`/api/gdpr/export`)
- Right to be forgotten (`/api/gdpr/delete`)
- Audit trail for all data processing

## 🔧 Type Checking

```bash
npm run type-check
```

## 📝 License

See [LICENSE](LICENSE) file.

## 🤝 Contributing

Contributions welcome! Please ensure:
1. TypeScript strict mode compliance
2. EU AI Act compliance for high-risk features
3. Audit logging for all state changes
4. Tests for critical paths

## 🆘 Support

For issues and questions:
- GitHub Issues: https://github.com/brandonlacoste9-tech/Omniclaws/issues
- Documentation: https://developers.cloudflare.com/workers/

## ⚠️ Important Notes

- **D1 Database IDs**: Update `wrangler.toml` with your actual D1 database ID
- **R2 Buckets**: Create buckets before deploying
- **Secrets**: Use `wrangler secret put` for production secrets
- **EU AI Act**: High-risk AI systems require additional legal review
- **Payment Integration**: Test in sandbox mode before production
