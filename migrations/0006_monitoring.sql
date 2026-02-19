-- Monitoring, analytics, and alerting

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  task_id TEXT,
  metadata_json TEXT,
  region TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp);

CREATE TABLE IF NOT EXISTS system_alerts (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('warning', 'critical', 'recovery')),
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_created ON system_alerts(created_at);
