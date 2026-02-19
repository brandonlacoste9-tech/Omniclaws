# PostHog + Resend Integration

This document covers the analytics and email infrastructure for Omniclaws.

---

## PostHog Analytics

### Setup

1. Sign up at https://app.posthog.com
2. Create a project named "Production"
3. Copy your project API key (starts with `phc_`)
4. Set the secret:
   ```bash
   npx wrangler secret put POSTHOG_API_KEY
   # Paste: phc_xxxxxxxxxxxxxxxx
   ```

### Tracked Events

| Event | When | Properties |
|-------|------|------------|
| `user_signed_up` | New user registration | email, region, attribution, plan |
| `task_executed` | Task completion | service, tier, cost, duration_ms, success |
| `credits_purchased` | Payment received | amount, revenue, currency, payment_provider |
| `credits_used` | Credit consumption | remaining, used, threshold |
| `feature_used` | Feature interaction | feature name, metadata |

### Usage in Code

```typescript
import { getAnalytics } from "./analytics/posthog";

// In your handler
const analytics = getAnalytics(env);

// Track signup
await analytics.trackSignup(userId, {
  email: user.email,
  region: "US",
  attribution: "reddit",
  plan: "free"
});

// Track task execution
await analytics.trackTaskExecuted(userId, {
  service: "openclaw",
  tier: "paid",
  cost: 0.05,
  success: true
});
```

---

## Resend Email Service

### Setup

1. Sign up at https://resend.com (use GitHub for fastest signup)
2. Add your domain:
   - Option A: Use `omniclaws.brandonlacoste9.workers.dev` (free, immediate)
   - Option B: Buy `omniclaws.io` and verify (recommended for production)
3. Verify domain (add DNS records in Cloudflare if using custom domain)
4. Copy your API key (starts with `re_`)
5. Set secrets:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   # Paste: re_xxxxxxxxxxxxxxxx
   
   npx wrangler secret put EMAIL_DOMAIN
   # Value: omniclaws.brandonlacoste9.workers.dev (or your custom domain)
   ```

### Email Flows

#### 1. Welcome Email (Immediate)
Sent when user signs up.

```typescript
const email = getEmailService(env);
await email.sendWelcomeEmail(user.email, {
  userId: user.id,
  freeTasks: 50,
  signupDate: new Date().toISOString()
});
```

#### 2. Low Credits Warning (Threshold-based)
Sent when user drops below threshold (default: 10 tasks remaining).

```typescript
await email.sendLowCreditsEmail(user.email, {
  userId: user.id,
  remaining: 8,
  used: 42,
  total: 50
});
```

#### 3. Weekly Report (Every 7 days)
Sent with usage stats and insights.

```typescript
await email.sendWeeklyReport(user.email, {
  userId: user.id,
  weekStart: "2024-02-12",
  tasksExecuted: 127,
  creditsSpent: 6.35,
  topServices: [
    { service: "q-emplois", count: 89 },
    { service: "zyeute-content", count: 38 }
  ],
  remainingCredits: 43
});
```

---

## Integration Points

### On User Signup

Add to your signup handler:

```typescript
// 1. Create user in database
const user = await createUser(env.DB, { email, region, ... });

// 2. Track in analytics
const analytics = getAnalytics(env);
await analytics.trackSignup(user.id, {
  email: user.email,
  region: tenant?.region || "US",
  attribution: ref || "direct",
  plan: "free"
});

// 3. Send welcome email
const emailService = getEmailService(env);
await emailService.sendWelcomeEmail(user.email, {
  userId: user.id,
  freeTasks: 50,
  signupDate: new Date().toISOString()
});
```

### On Task Execution

Add to your task handler:

```typescript
const startTime = Date.now();
const result = await executeTask(task);
const duration = Date.now() - startTime;

// Track execution
await analytics.trackTaskExecuted(userId, {
  service: task.service,
  tier: user.plan,
  cost: task.cost,
  duration_ms: duration,
  success: result.success,
  error_type: result.error ? result.error.split(':')[0] : undefined
});

// Check for low credits threshold
const balance = await getCreditBalance(userId, env.DB);
if (balance.remaining <= 10 && balance.remaining > 0) {
  await emailService.sendLowCreditsEmail(user.email, {
    userId,
    remaining: balance.remaining,
    used: 50 - balance.remaining,
    total: 50
  });
}
```

### On Credit Purchase

Add to your billing webhook handler:

```typescript
await analytics.trackCreditsPurchased(userId, {
  amount: creditsPurchased,
  revenue: amountInDollars,
  currency: "USD",
  payment_provider: "stripe", // or "paddle"
  package_type: "100-pack"
});
```

---

## Environment Variables

Add to `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
EMAIL_DOMAIN = "omniclaws.brandonlacoste9.workers.dev"

# Secrets (set via `wrangler secret put`)
# POSTHOG_API_KEY = "phc_xxx"
# RESEND_API_KEY = "re_xxx"
```

---

## Testing

### Test PostHog

```bash
curl -X POST https://us.i.posthog.com/capture/ \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "phc_your_test_key",
    "event": "test_event",
    "distinct_id": "test_user_123",
    "properties": {"test": true}
  }'
```

### Test Resend

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer re_your_test_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "test@omniclaws.brandonlacoste9.workers.dev",
    "to": "your@email.com",
    "subject": "Test from Omniclaws",
    "text": "Hello from the hive!"
  }'
```

---

## Privacy & Compliance

- PostHog: GDPR-compliant with EU data residency option
- Resend: No storage of email content, just delivery logs
- Both services allow data export/deletion on request

For EU users, consider self-hosting PostHog or using their EU cloud option.
