-- IP-based rate limiting for /openclaw/execute (prevents script abuse)
-- Window: 1 minute per IP, max 30 requests/min

CREATE TABLE IF NOT EXISTS rate_limit (
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  PRIMARY KEY (ip, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit(window_start);
