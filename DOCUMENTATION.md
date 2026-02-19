# Omniclaws Platform Documentation

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account with Workers, D1, and R2 enabled
- Wrangler CLI installed (`npm install -g wrangler`)

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Create D1 Database:**
```bash
wrangler d1 create omniclaws-db
```
Copy the database_id and update it in `wrangler.toml`.

3. **Run migrations:**
```bash
wrangler d1 execute omniclaws-db --file=./migrations/0001_initial_schema.sql
```

4. **Create R2 Bucket:**
```bash
wrangler r2 bucket create omniclaws-audit-logs
```

5. **Create KV Namespace (optional):**
```bash
wrangler kv:namespace create CACHE
```
Copy the id and update it in `wrangler.toml`.

6. **Set Environment Variables:**
```bash
# Paddle API Key (for EU/UK billing)
wrangler secret put PADDLE_API_KEY

# Stripe Secret Key (for US/CA billing)
wrangler secret put STRIPE_SECRET_KEY

# Optional: OpenAI API Key
wrangler secret put OPENAI_API_KEY
```

### Development

Run locally:
```bash
npm run dev
```

### Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

## API Documentation

### Base URL
```
https://omniclaws.your-subdomain.workers.dev
```

### Authentication
All API requests require an API key in the Authorization header:
```
Authorization: Bearer YOUR_API_KEY
```

### Endpoints

#### 1. Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "Omniclaws",
  "version": "1.0.0",
  "edge_location": "US",
  "billing_provider": "stripe",
  "timestamp": "2024-02-19T07:00:00.000Z"
}
```

#### 2. Execute Task
```
POST /api/task
```

**Headers:**
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "service": "openclaw-api",
  "input": {
    "type": "data_processing",
    "parameters": {
      "data": [1, 2, 3, 4, 5],
      "operation": "aggregate"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "result": {
    "success": true,
    "output": { "aggregated": true, "total": 5 },
    "executionTime": 123,
    "timestamp": 1708327200000
  },
  "billing": {
    "provider": "stripe",
    "charged": true
  }
}
```

#### 3. Get Task Status
```
GET /api/task/{taskId}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "output": { "result": "..." },
  "createdAt": 1708327200,
  "completedAt": 1708327205
}
```

#### 4. Get Billing Summary
```
GET /api/billing/summary
```

**Headers:**
- `Authorization: Bearer YOUR_API_KEY`

**Response:**
```json
{
  "totalTasks": 150,
  "totalAmount": 7.50,
  "currency": "USD",
  "breakdown": {
    "openclaw-api": 100,
    "q-emplois": 30,
    "zyeute-content": 20
  }
}
```

#### 5. Get Pending Human Reviews
```
GET /api/reviews/pending
```

**Response:**
```json
{
  "count": 5,
  "reviews": [
    {
      "taskId": "...",
      "userId": "...",
      "input": { "candidate": "...", "job": "..." },
      "screeningResult": { "score": 0.85, "confidence": 0.93 },
      "createdAt": 1708327200
    }
  ]
}
```

## Services

### 1. OpenClaw API (openclaw-api)
General-purpose task execution engine.

**Supported task types:**
- `data_processing`: Transform, filter, or aggregate data
- `api_call`: Make external API requests
- `computation`: Perform calculations

**Example:**
```json
{
  "service": "openclaw-api",
  "input": {
    "type": "computation",
    "parameters": {
      "operation": "sum",
      "values": [10, 20, 30]
    }
  }
}
```

### 2. Q-Emplois (q-emplois) - HIGH RISK ⚠️
Recruitment AI service for candidate screening.

**EU AI Act Compliance:**
- Classified as high-risk under Article 6
- Confidence threshold: 0.95
- Requires human review if confidence < 0.95
- All decisions logged to R2 for audit trail

**Example:**
```json
{
  "service": "q-emplois",
  "input": {
    "candidate": {
      "name": "John Doe",
      "email": "john@example.com",
      "resume": "...",
      "skills": ["JavaScript", "Python", "React"],
      "experience_years": 5,
      "education": "bachelor",
      "location": "Paris"
    },
    "job": {
      "title": "Senior Developer",
      "required_skills": ["JavaScript", "React", "Node.js"],
      "min_experience_years": 3,
      "education_level": "bachelor"
    }
  }
}
```

### 3. Zyeute Content (zyeute-content)
Content arbitrage bot for automated content discovery and distribution.

**Example:**
```json
{
  "service": "zyeute-content",
  "input": {
    "sources": [
      {
        "url": "https://example.com/feed",
        "type": "article",
        "keywords": ["tech", "ai", "programming"]
      }
    ],
    "targets": [
      {
        "platform": "twitter",
        "accountId": "my_account"
      }
    ],
    "filters": {
      "minQuality": 0.7,
      "maxAge": 24,
      "excludeKeywords": ["politics"]
    }
  }
}
```

## Compliance Features

### EU AI Act Article 6
- **High-risk AI systems** (recruitment) require:
  - Risk assessment before execution
  - Confidence threshold ≥ 0.95 for automated processing
  - Human-in-the-loop for low-confidence decisions
  - Immutable audit logging to R2

### GDPR (Regulation EU 2016/679)
- **Data residency**: EU user data processed at EU edge locations
- **Right to access**: Query audit logs via API
- **Right to erasure**: Delete user data on request
- **Data minimization**: Personal data anonymized in logs

### Multi-Tenant Billing
- **EU/UK**: Paddle (Merchant of Record, handles VAT automatically)
- **US/CA**: Stripe (usage-based metering)
- **Pricing**: $0.05 per task execution

## Self-Healing Architecture

### Automatic Retry Logic
- Failed tasks retry 3 times with exponential backoff
- Retry delays: 1s, 2s, 4s
- Circuit breakers prevent cascading failures

### Failed Task Queue
- Failed tasks stored in D1 `failed_tasks` table
- Cron job runs every 5 minutes to reprocess
- Max 3 retry attempts before manual intervention

## Monitoring & Observability

### Audit Logs (R2)
All critical operations logged to R2:
- Task executions
- AI decisions (with rationale)
- Billing events
- Compliance checks
- Human reviews

**Log structure:**
```
audit-logs/
  2024/
    02/
      19/
        07/
          ai_decision/
            {log_id}.json
```

### Performance Targets
- **Latency**: <50ms response time (edge caching)
- **Availability**: 99.9% uptime
- **Compliance**: 100% audit coverage for high-risk AI

## Environment Variables

Required environment variables (set via `wrangler secret put`):

| Variable | Description | Required |
|----------|-------------|----------|
| `PADDLE_API_KEY` | Paddle API key for EU/UK billing | Yes |
| `STRIPE_SECRET_KEY` | Stripe secret key for US/CA billing | Yes |
| `OPENAI_API_KEY` | OpenAI API key (optional) | No |

## Database Schema

See `migrations/0001_initial_schema.sql` for complete schema.

**Key tables:**
- `users`: User accounts with API keys
- `tasks`: Task execution tracking
- `failed_tasks`: Failed task retry queue
- `usage`: Billing usage records
- `ai_risk_assessments`: EU AI Act compliance records

## Security Best Practices

1. **API Keys**: Store in environment variables, never in code
2. **Rate Limiting**: Implement at Cloudflare level
3. **Input Validation**: Validate all user inputs
4. **Audit Logging**: All critical operations logged to R2
5. **HTTPS Only**: All traffic encrypted in transit

## Support

For issues or questions:
- Email: support@omniclaws.com
- Documentation: https://docs.omniclaws.com
- GitHub: https://github.com/brandonlacoste9-tech/Omniclaws

## License

See LICENSE file for details.
