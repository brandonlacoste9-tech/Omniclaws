-- Nevermined-style usage ledger for micro-transactions
-- Sub-cent precision, batch for billing at $1.00 threshold

CREATE TABLE IF NOT EXISTS usage_ledger (
  reservation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'confirmed', 'failed', 'processed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  processed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_ledger_reservation ON usage_ledger(reservation_id);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_status ON usage_ledger(user_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_created ON usage_ledger(created_at);

-- Circuit breaker: track error rate over 5-min window
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  period_start_ts INTEGER NOT NULL,
  total_requests INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  circuit_open_until_ts INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO circuit_breaker_state (id, period_start_ts, total_requests, error_count, circuit_open_until_ts)
VALUES ('default', 0, 0, 0, 0);
