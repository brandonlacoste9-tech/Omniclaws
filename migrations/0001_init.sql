-- Omniclaws D1 schema: task queues, user data, failed tasks
-- Run: wrangler d1 migrations apply omniclaws-db

-- Task queue for processing
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- Failed tasks for cron reprocessing (self-healing)
CREATE TABLE IF NOT EXISTS failed_tasks (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_retry_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_failed_tasks_retry ON failed_tasks(retry_count);
CREATE INDEX IF NOT EXISTS idx_failed_tasks_created ON failed_tasks(created_at);

-- Tenant/customer mapping for billing
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  paddle_customer_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
