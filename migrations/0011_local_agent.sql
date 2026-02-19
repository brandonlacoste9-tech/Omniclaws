-- Local Agent mode: distributed mesh for zero-cost AI execution

-- Add agent assignment columns to tasks
ALTER TABLE tasks ADD COLUMN assigned_agent TEXT;
ALTER TABLE tasks ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent ON tasks(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed ON tasks(assigned_agent, status);

-- Agents table: registered local agents
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret TEXT NOT NULL UNIQUE,
  last_poll_at TEXT,
  status TEXT DEFAULT 'active',
  capabilities TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_secret ON agents(secret);
