-- Omniclaws Database Schema
-- Users table for multi-tenant support
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    country_code TEXT NOT NULL,
    billing_provider TEXT NOT NULL CHECK(billing_provider IN ('paddle', 'stripe')),
    api_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Tasks table for tracking task execution
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    service TEXT NOT NULL CHECK(service IN ('openclaw-api', 'q-emplois', 'zyeute-content')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
    input TEXT NOT NULL,
    output TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Failed tasks table for retry processing
CREATE TABLE IF NOT EXISTS failed_tasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    service TEXT NOT NULL,
    input TEXT NOT NULL,
    error TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Usage tracking for billing
CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    service TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0.05,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- AI risk assessments for EU AI Act compliance
CREATE TABLE IF NOT EXISTS ai_risk_assessments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    service TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('high', 'medium', 'low')),
    confidence REAL NOT NULL,
    requires_human_review INTEGER NOT NULL DEFAULT 0,
    human_reviewed_at INTEGER,
    decision_rationale TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_failed_tasks_next_retry ON failed_tasks(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage(created_at);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_task_id ON ai_risk_assessments(task_id);
