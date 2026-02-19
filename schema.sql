-- D1 Database Schema for Omniclaws Platform
-- Run with: wrangler d1 execute omniclaws_db --file=schema.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  region TEXT NOT NULL, -- EU, UK, US, CA for geo-routing
  payment_provider TEXT, -- paddle or stripe
  subscription_tier TEXT DEFAULT 'free' -- free, pro, enterprise
);

-- Task queue for automation jobs
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  service TEXT NOT NULL, -- openclaw, q-emplois, zyeute
  task_type TEXT NOT NULL, -- scraping, form_filling, scheduling, etc.
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  payload TEXT NOT NULL, -- JSON payload
  result TEXT, -- JSON result
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_service ON tasks(service);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Usage tracking for billing
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  service TEXT NOT NULL,
  task_id TEXT,
  amount REAL NOT NULL, -- Cost in USD
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage(created_at);

-- Human oversight queue for high-risk AI decisions
CREATE TABLE IF NOT EXISTS human_oversight_queue (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  service TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  ai_recommendation TEXT NOT NULL, -- JSON
  human_decision TEXT, -- JSON
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewer_id TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_oversight_status ON human_oversight_queue(status);
CREATE INDEX IF NOT EXISTS idx_oversight_service ON human_oversight_queue(service);

-- Payment transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- paddle or stripe
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, completed, failed, refunded
  provider_transaction_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
