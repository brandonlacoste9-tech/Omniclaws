-- Referral system: 20% commission on referred users' spending

CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  total_referrals INTEGER DEFAULT 0,
  total_earnings_cents INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id);

CREATE TABLE IF NOT EXISTS referrer_balances (
  user_id TEXT PRIMARY KEY,
  balance_cents INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_ledger (
  id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL,
  spender_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  referral_code_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_ledger_referrer ON referral_ledger(referrer_id);

-- Maps user_id -> referral_code_id (who referred them)
CREATE TABLE IF NOT EXISTS referral_links (
  user_id TEXT PRIMARY KEY,
  referral_code_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);

CREATE TABLE IF NOT EXISTS referral_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
