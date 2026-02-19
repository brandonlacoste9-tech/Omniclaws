-- Stripe Checkout sessions for hosted payment flow

CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_user ON billing_checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkout_status ON billing_checkout_sessions(status);
