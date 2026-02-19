-- Freemium model: OpenClaw Basic FREE, Pro PAID

ALTER TABLE tasks ADD COLUMN price_tier TEXT;
ALTER TABLE tasks ADD COLUMN charged INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_price_tier ON tasks(price_tier);
CREATE INDEX IF NOT EXISTS idx_tasks_free_usage ON tasks(tenant_id, created_at);
