-- Add tenant_id to whale_subscriptions for per-tenant pricing
ALTER TABLE whale_subscriptions ADD COLUMN tenant_id TEXT DEFAULT 'omniclaws';
