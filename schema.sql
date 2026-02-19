-- D1 Database Schema for Omniclaws
-- Run with: wrangler d1 execute omniclaws-db --file=./schema.sql

-- Users table for multi-tenant system
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL,
  payment_provider TEXT NOT NULL CHECK(payment_provider IN ('paddle', 'stripe')),
  customer_id TEXT,
  api_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Task queue for self-healing system
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('openclaw', 'q-emplois', 'zyeute-content')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Failed tasks for cron reprocessing
CREATE TABLE IF NOT EXISTS failed_tasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  failed_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Usage tracking for billing
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  amount REAL NOT NULL,
  billing_period TEXT NOT NULL,
  invoiced INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- EU AI Act compliance records
CREATE TABLE IF NOT EXISTS ai_risk_assessments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high')),
  confidence_score REAL NOT NULL,
  requires_human_review INTEGER NOT NULL,
  human_review_status TEXT CHECK(human_review_status IN ('pending', 'approved', 'rejected')),
  decision_rationale TEXT NOT NULL,
  assessed_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_failed_tasks_next_retry ON failed_tasks(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_billing ON usage(user_id, billing_period);
CREATE INDEX IF NOT EXISTS idx_ai_risk_human_review ON ai_risk_assessments(requires_human_review, human_review_status);
