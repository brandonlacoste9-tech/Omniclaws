-- WhaleWatcher: blockchain transaction monitoring, $0.10/alert

CREATE TABLE IF NOT EXISTS whale_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('btc', 'eth')),
  min_value_usd INTEGER NOT NULL DEFAULT 100000,
  webhook_url TEXT,
  email TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_whale_subs_chain_active ON whale_subscriptions(chain, active);
CREATE INDEX IF NOT EXISTS idx_whale_subs_user ON whale_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS whale_alerts (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  value_usd REAL NOT NULL,
  detected_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whale_alerts_tx ON whale_alerts(chain, tx_hash);
CREATE INDEX IF NOT EXISTS idx_whale_alerts_detected ON whale_alerts(detected_at);

CREATE TABLE IF NOT EXISTS whale_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  delivered_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  error_message TEXT,
  FOREIGN KEY (alert_id) REFERENCES whale_alerts(id)
);

CREATE INDEX IF NOT EXISTS idx_whale_deliveries_user_hour ON whale_deliveries(user_id, delivered_at);
