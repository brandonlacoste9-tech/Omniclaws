-- Zyeuté content arbitrage: scraped content with affiliate monetization

CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  last_scraped_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_url)
);

CREATE TABLE IF NOT EXISTS content_jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  affiliate_links TEXT,
  commission_cents INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready_to_publish' CHECK (status IN ('ready_to_publish', 'published')),
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_jobs_status ON content_jobs(status);
CREATE INDEX IF NOT EXISTS idx_content_jobs_created ON content_jobs(created_at);
