# Omniclaws

**Global Edge-Based AI Monetization Platform**

Omniclaws is a distributed automation platform that turns AI agents into revenue streams. It runs on Cloudflare's edge network (200+ locations), handles global payments (Paddle/Stripe), and maintains compliance with EU AI Act — all while you sleep. From automated recruitment to content arbitrage, it claws profit from every timezone simultaneously.

## 🚀 Features

- **Edge Computing**: Deployed on Cloudflare Workers across 200+ global locations
- **Multi-Tenant Billing**: Automatic geo-routing to Paddle (EU/UK) or Stripe (US/CA)
- **EU AI Act Compliant**: High-risk AI systems with human-in-the-loop oversight
- **GDPR Ready**: Data residency enforcement and privacy-by-design
- **Self-Healing**: Automatic retry with exponential backoff and circuit breakers
- **Immutable Audit Logs**: R2-based compliance logging for 7+ years retention
- **Sub-50ms Latency**: Edge caching and optimized routing

## 📋 Services

### 1. OpenClaw API
General-purpose task execution engine for data processing, API calls, and computations.

### 2. Q-Emplois (High-Risk AI)
Recruitment automation with EU AI Act Article 6 compliance:
- Automated candidate screening
- Confidence threshold: 0.95
- Human review for low-confidence decisions
- Immutable decision logging

### 3. Zyeute Content
Content arbitrage bot for automated discovery and distribution across platforms.

## 🏗️ Architecture

```
src/
├── index.ts                    # Main Worker entry point
├── billing/
│   ├── router.ts              # Geo-based billing routing
│   ├── paddle.ts              # EU/UK MoR integration
│   └── stripe.ts              # US/CA usage-based billing
├── compliance/
│   ├── eu-ai-act.ts           # High-risk AI compliance
│   ├── gdpr.ts                # Data residency enforcement
│   └── audit-logger.ts        # R2 immutable logging
├── services/
│   ├── openclaw-api.ts        # Task execution engine
│   ├── q-emplois.ts           # Recruitment AI
│   └── zyeute-content.ts      # Content arbitrage
└── utils/
    ├── geo-router.ts          # CF-IPCountry routing
    └── failover.ts            # Circuit breakers & retry
```

## 🚀 Quick Start

See [SETUP.md](./SETUP.md) for detailed setup instructions.

```bash
# 1. Install dependencies
npm install

# 2. Create D1 database
wrangler d1 create omniclaws-db

# 3. Run migrations
wrangler d1 execute omniclaws-db --file=./migrations/0001_initial_schema.sql

# 4. Create R2 bucket
wrangler r2 bucket create omniclaws-audit-logs

# 5. Set secrets
wrangler secret put PADDLE_API_KEY
wrangler secret put STRIPE_SECRET_KEY

# 6. Deploy
npm run deploy
```

## 📖 Documentation

- [Setup Guide](./SETUP.md) - Complete installation and configuration
- [API Documentation](./DOCUMENTATION.md) - Endpoints, examples, and compliance
- [Examples](./src/examples.ts) - Code examples for all services

## 🔒 Compliance

### EU AI Act (Article 6)
- **High-Risk Systems**: Recruitment AI requires 95% confidence or human review
- **Transparency**: All AI decisions logged with rationale
- **Human Oversight**: Mandatory review queue for low-confidence decisions
- **Audit Trail**: Immutable R2 logs for 7+ years

### GDPR (Regulation EU 2016/679)
- **Data Residency**: EU data processed at EU edge locations
- **Privacy by Design**: Anonymized logs, minimal data retention
- **User Rights**: Access, rectification, erasure, portability
- **Lawful Basis**: Explicit consent for automated decision-making

## 💰 Pricing

**$0.05 per task execution**

- EU/UK: Billed via Paddle (VAT handled automatically)
- US/CA: Billed via Stripe (usage-based metering)
- Global: Edge routing minimizes latency costs

## 🛠️ Tech Stack

- **Runtime**: Cloudflare Workers (compatibility_date 2024-02-19)
- **Language**: TypeScript with strict mode
- **Database**: D1 (SQLite at the edge)
- **Storage**: R2 (immutable audit logs)
- **Queue**: D1 + Cron triggers (every 5 minutes)

## 📊 Performance

- **Latency**: <50ms response time (edge caching)
- **Availability**: 99.9% uptime (Cloudflare SLA)
- **Throughput**: 100K+ requests/second per region
- **Compliance**: 100% audit coverage for high-risk AI

## 🔧 Development

```bash
# Type checking
npm run type-check

# Local development
npm run dev

# Deploy to production
npm run deploy

# View logs
wrangler tail
```

## 🧪 Testing

See [src/examples.ts](./src/examples.ts) for test examples:

```typescript
// Test geo-routing
await testGeoRouting();

// Test EU AI Act compliance
await testEUAIAct();

// Test GDPR
await testGDPR();

// Test failover
await testFailover();
```

## 📝 License

See [LICENSE](./LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please ensure:
- TypeScript strict mode compliance
- EU AI Act compliance for high-risk features
- Comprehensive audit logging
- Tests for new features

## 📧 Support

- GitHub Issues: [Report a bug](https://github.com/brandonlacoste9-tech/Omniclaws/issues)
- Documentation: [DOCUMENTATION.md](./DOCUMENTATION.md)
- Setup Guide: [SETUP.md](./SETUP.md)

---

**Built with ❤️ for the edge computing era**
