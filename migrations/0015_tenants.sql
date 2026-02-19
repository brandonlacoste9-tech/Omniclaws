-- Multi-tenant: spawn unlimited branded sites from one instance
-- Note: "tenants" in 0001 is billing customer mapping. We use "tenant_configs" for branded sites.

CREATE TABLE IF NOT EXISTS tenant_configs (
  id TEXT PRIMARY KEY,
  subdomain TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand_color TEXT DEFAULT '#3b82f6',
  logo_url TEXT,
  headline TEXT DEFAULT 'AI Automation Platform',
  subhead TEXT DEFAULT '50 free tasks daily',
  pricing_multiplier REAL DEFAULT 1.0,
  allowed_features TEXT DEFAULT 'openclaw,whale',
  stripe_account_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_configs_subdomain ON tenant_configs(subdomain);

INSERT OR IGNORE INTO tenant_configs (id, subdomain, name, headline, subhead, pricing_multiplier, allowed_features) VALUES
  ('omniclaws', 'omniclaws.brandonlacoste9.workers.dev', 'Omniclaws', 'The 24/7 Revenue Claw', '50 free tasks daily. ETH + BTC whale alerts.', 1.0, 'openclaw,whale,referral'),
  ('whalewatcher', 'whale-watcher.com', 'WhaleWatcher', 'Crypto Whale Alerts in Real-Time', '$100k+ moves on ETH & BTC', 1.5, 'whale'),
  ('taskclaw', 'task-claw.com', 'TaskClaw', 'Developer Automation Tools', '50 free tasks daily. Bring your own AI.', 0.8, 'openclaw');
