-- Credit Wallet: Buy packs, spend credits (avoids Stripe micro-transaction fees)

CREATE TABLE IF NOT EXISTS user_credits (
  user_id TEXT PRIMARY KEY,
  credit_balance INTEGER DEFAULT 0,
  free_tasks_used_today INTEGER DEFAULT 0,
  last_reset_date TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_credits_reset ON user_credits(last_reset_date);

-- cost_credits: 0=free, 1=pro/ai
ALTER TABLE tasks ADD COLUMN cost_credits INTEGER DEFAULT 0;

-- Credit purchase records (for webhook idempotency)
CREATE TABLE IF NOT EXISTS credit_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  credits_added INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  stripe_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_stripe ON credit_purchases(stripe_session_id);
