# Multi-Tenant Setup

One backend, unlimited branded sites. Each domain gets its own landing page, pricing, and feature set.

## Tenants (Pre-configured)

| Tenant | Subdomain | Pricing | Features |
|--------|-----------|---------|----------|
| **Omniclaws** | omniclaws.brandonlacoste9.workers.dev | $1.00/task | openclaw, whale, referral |
| **WhaleWatcher** | whale-watcher.com | $0.15/alert (1.5x) | whale only |
| **TaskClaw** | task-claw.com | $0.80/task (0.8x) | openclaw only |

## Add Custom Domains

1. Buy domain (e.g. whale-watcher.com, task-claw.com)
2. Cloudflare Dashboard → Workers → Omniclaws → Triggers → **Add Custom Domain**
3. Add domain and point to your Worker
4. Ensure the domain is in `tenant_configs.subdomain` (already seeded)

## How It Works

- **Host-based routing**: Request host (e.g. `whale-watcher.com`) is matched against `tenant_configs.subdomain`
- **Fallback**: Unknown hosts use `omniclaws` tenant
- **Feature gating**: `allowed_features` controls which endpoints are available (403 if not allowed)
- **Pricing**: `pricing_multiplier` applies to credit packs and whale alerts

## Database

- `tenant_configs` – branded site config (id, subdomain, name, pricing_multiplier, allowed_features)
- `whale_subscriptions.tenant_id` – links subscription to tenant for per-tenant alert pricing

## Add New Tenant

```sql
INSERT INTO tenant_configs (id, subdomain, name, headline, subhead, pricing_multiplier, allowed_features)
VALUES ('pico-claw', 'pico-claw.com', 'PicoClaw', 'Physical Agent Automation', '...', 1.2, 'openclaw');
```
