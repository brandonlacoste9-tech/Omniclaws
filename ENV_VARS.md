# Environment Variables

This document lists all required environment variables for the Omniclaws platform.

## Required Variables

### Payment Processing

#### PADDLE_API_KEY
- **Description**: Paddle API key for EU/UK payment processing
- **Type**: Secret
- **Required**: Yes
- **Usage**: Handles VAT-compliant payments as Merchant of Record
- **How to get**: Sign up at https://paddle.com, navigate to Settings > Developer Tools
- **Set with**: `wrangler secret put PADDLE_API_KEY`

#### STRIPE_SECRET_KEY
- **Description**: Stripe secret API key for US/CA payment processing
- **Type**: Secret
- **Required**: Yes
- **Usage**: Handles usage-based metering and subscriptions
- **How to get**: Sign up at https://stripe.com, navigate to Developers > API keys
- **Set with**: `wrangler secret put STRIPE_SECRET_KEY`

### Micro-Transactions

#### NEVERMINED_API_KEY
- **Description**: Nevermined API key for micro-transaction tracking
- **Type**: Secret
- **Required**: Yes (if using micro-transaction features)
- **Usage**: Tracks per-task billing and usage metrics
- **How to get**: Sign up at https://nevermined.io and access your dashboard
- **Set with**: `wrangler secret put NEVERMINED_API_KEY`

## Cloudflare Bindings

These are configured in `wrangler.toml` and managed by Cloudflare:

### DB
- **Type**: D1 Database
- **Description**: SQLite database for task queues and user management
- **Configuration**: Set `database_id` in wrangler.toml after creating the database

### AUDIT_LOGS
- **Type**: R2 Bucket
- **Description**: Append-only storage for compliance audit logs
- **Configuration**: Create bucket with `wrangler r2 bucket create omniclaws-audit-logs`

## Setting Environment Variables

### Development
For local development, you can use a `.dev.vars` file (not committed to git):

```bash
# .dev.vars
PADDLE_API_KEY=your_paddle_key_here
STRIPE_SECRET_KEY=your_stripe_key_here
NEVERMINED_API_KEY=your_nevermined_key_here
```

### Production
For production, use Wrangler secrets:

```bash
wrangler secret put PADDLE_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put NEVERMINED_API_KEY
```

You will be prompted to enter each value securely.

## Verification

To verify your environment variables are set correctly:

```bash
wrangler secret list
```

This will show which secrets are configured (but not their values).

## Security Notes

- Never commit API keys to version control
- Keep `.dev.vars` in `.gitignore`
- Rotate keys regularly
- Use different keys for development and production
- Monitor API key usage in respective dashboards
