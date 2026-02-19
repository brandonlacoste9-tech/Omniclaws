-- Billing customers and transaction log for Stripe/Paddle integration

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id TEXT PRIMARY KEY,
  paddle_customer_id TEXT,
  stripe_customer_id TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_country ON billing_customers(country);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paddle')),
  provider_transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'requires_confirmation')),
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES billing_customers(user_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_user ON billing_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_created ON billing_transactions(created_at);
