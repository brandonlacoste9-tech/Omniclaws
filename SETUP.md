# Omniclaws Platform - Setup Guide

## Quick Start

This guide will walk you through setting up the Omniclaws platform from scratch.

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- A Cloudflare account (free tier works)
- Wrangler CLI (`npm install -g wrangler`)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

This will open a browser window for authentication.

### 3. Create D1 Database

```bash
# Create the database
wrangler d1 create omniclaws-db

# Copy the database_id from the output
# Update wrangler.toml with your database_id
```

Update `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "omniclaws-db"
database_id = "YOUR_DATABASE_ID_HERE"  # Replace with actual ID
```

### 4. Run Database Migrations

```bash
# Apply the schema
wrangler d1 execute omniclaws-db --local --file=./migrations/0001_initial_schema.sql

# For production
wrangler d1 execute omniclaws-db --remote --file=./migrations/0001_initial_schema.sql
```

### 5. Create R2 Bucket for Audit Logs

```bash
wrangler r2 bucket create omniclaws-audit-logs
```

### 6. Create KV Namespace (Optional, for caching)

```bash
# Create KV namespace
wrangler kv:namespace create CACHE

# Copy the id from output and update wrangler.toml
```

Update `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_ID_HERE"  # Replace with actual ID
```

### 7. Set Environment Variables (Secrets)

```bash
# Paddle API Key (for EU/UK billing)
wrangler secret put PADDLE_API_KEY
# Paste your Paddle API key when prompted

# Stripe Secret Key (for US/CA billing)
wrangler secret put STRIPE_SECRET_KEY
# Paste your Stripe secret key when prompted

# Optional: OpenAI API Key
wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key when prompted
```

### 8. Test Locally

```bash
npm run dev
```

Your worker will be available at `http://localhost:8787`

### 9. Deploy to Production

```bash
npm run deploy
```

Your worker will be deployed to Cloudflare's edge network!

## Initial Data Setup

### Create Your First User

You'll need to manually insert your first user into the D1 database:

```bash
# Generate a UUID for user ID (or use any string)
USER_ID="your-user-id"
API_KEY="your-api-key"

# Insert user
wrangler d1 execute omniclaws-db --remote --command \
  "INSERT INTO users (id, email, country_code, billing_provider, api_key, created_at, updated_at) \
   VALUES ('$USER_ID', 'you@example.com', 'US', 'stripe', '$API_KEY', strftime('%s', 'now'), strftime('%s', 'now'))"
```

Save your API_KEY - you'll need it to make API requests!

## Testing Your Deployment

### 1. Health Check

```bash
curl https://your-worker.workers.dev/health
```

Expected response:
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

### 2. Execute a Simple Task

```bash
curl -X POST https://your-worker.workers.dev/api/task \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "openclaw-api",
    "input": {
      "type": "computation",
      "parameters": {
        "operation": "sum",
        "values": [10, 20, 30]
      }
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "result": {
    "success": true,
    "output": { "result": 60 },
    "executionTime": 123,
    "timestamp": 1708327200000
  },
  "billing": {
    "provider": "stripe",
    "charged": true
  }
}
```

### 3. Get Task Status

```bash
curl https://your-worker.workers.dev/api/task/TASK_ID
```

### 4. Get Billing Summary

```bash
curl https://your-worker.workers.dev/api/billing/summary \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Configuration Options

### wrangler.toml

Key configuration options in `wrangler.toml`:

- `compatibility_date`: Cloudflare Workers compatibility date (2024-02-19)
- `compatibility_flags`: Enable Node.js compatibility
- `d1_databases`: D1 database binding
- `r2_buckets`: R2 bucket for audit logs
- `kv_namespaces`: KV namespace for caching
- `triggers.crons`: Cron schedule for failed task reprocessing (every 5 minutes)

### Environment Variables

Set via `wrangler secret put`:

- `PADDLE_API_KEY` - Required for EU/UK billing
- `STRIPE_SECRET_KEY` - Required for US/CA billing
- `OPENAI_API_KEY` - Optional, for AI services

## Monitoring and Debugging

### View Logs

```bash
# Tail logs in real-time
wrangler tail

# View logs for production
wrangler tail --env production
```

### Query D1 Database

```bash
# List all users
wrangler d1 execute omniclaws-db --remote --command "SELECT * FROM users"

# List recent tasks
wrangler d1 execute omniclaws-db --remote --command \
  "SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10"

# Check failed tasks
wrangler d1 execute omniclaws-db --remote --command \
  "SELECT * FROM failed_tasks WHERE retry_count < 3"

# View AI risk assessments
wrangler d1 execute omniclaws-db --remote --command \
  "SELECT * FROM ai_risk_assessments WHERE requires_human_review = 1"
```

### View R2 Audit Logs

```bash
# List audit logs
wrangler r2 object list omniclaws-audit-logs --prefix="audit-logs/2024/"

# Download a specific log
wrangler r2 object get omniclaws-audit-logs/audit-logs/2024/02/19/07/ai_decision/{log_id}.json
```

## Troubleshooting

### Common Issues

1. **"Database not found"**
   - Make sure you created the D1 database and updated `wrangler.toml` with the correct ID
   - Run migrations with `wrangler d1 execute`

2. **"API key not configured"**
   - Set secrets using `wrangler secret put PADDLE_API_KEY` and `STRIPE_SECRET_KEY`

3. **"User not found"**
   - Insert a test user into the database (see Initial Data Setup)

4. **Type errors during deployment**
   - Run `npm run type-check` to verify TypeScript compilation
   - Make sure all dependencies are installed

5. **Cron triggers not running**
   - Cron triggers only work in production, not in local development
   - Check logs with `wrangler tail` to see cron execution

### Getting Help

- Check logs: `wrangler tail`
- Review documentation: `DOCUMENTATION.md`
- Check Cloudflare Workers documentation: https://developers.cloudflare.com/workers/

## Security Best Practices

1. **Never commit secrets**: Use `wrangler secret put` for API keys
2. **Rotate API keys regularly**: Update secrets periodically
3. **Use environment-specific configurations**: Separate dev and prod environments
4. **Monitor audit logs**: Regularly review R2 logs for suspicious activity
5. **Enable rate limiting**: Configure at Cloudflare dashboard level

## Production Checklist

Before going live:

- [ ] All secrets configured (`PADDLE_API_KEY`, `STRIPE_SECRET_KEY`)
- [ ] D1 database created and migrated
- [ ] R2 bucket created for audit logs
- [ ] Test user created and API key verified
- [ ] All API endpoints tested
- [ ] Cron triggers configured (every 5 minutes)
- [ ] Monitoring and alerting set up
- [ ] Rate limiting configured in Cloudflare dashboard
- [ ] Custom domain configured (optional)
- [ ] GDPR compliance reviewed for EU users
- [ ] EU AI Act compliance reviewed for high-risk services

## Next Steps

1. Set up billing accounts:
   - Create Paddle account for EU/UK: https://paddle.com
   - Create Stripe account for US/CA: https://stripe.com

2. Configure webhooks for billing events

3. Set up monitoring and alerting

4. Implement custom business logic in services

5. Add authentication and authorization layers

6. Configure custom domain in Cloudflare dashboard

## Support

For issues or questions:
- GitHub Issues: https://github.com/brandonlacoste9-tech/Omniclaws/issues
- Documentation: DOCUMENTATION.md
- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/
