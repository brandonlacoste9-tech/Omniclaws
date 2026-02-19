-- Attribution tracking for manual marketing (clicks, signups, conversions, revenue)

CREATE TABLE IF NOT EXISTS attribution_links (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  campaign TEXT,
  creator TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  clicks INTEGER DEFAULT 0,
  signups INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue_cents INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attribution_links_source ON attribution_links(source);

CREATE TABLE IF NOT EXISTS click_events (
  id TEXT PRIMARY KEY,
  attribution_id TEXT NOT NULL,
  user_id TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (attribution_id) REFERENCES attribution_links(id)
);

CREATE INDEX IF NOT EXISTS idx_click_events_attribution ON click_events(attribution_id);

-- Maps user_id -> attribution_id (first touch)
CREATE TABLE IF NOT EXISTS user_attribution (
  user_id TEXT PRIMARY KEY,
  attribution_id TEXT NOT NULL,
  first_seen INTEGER DEFAULT (strftime('%s', 'now')),
  converted INTEGER DEFAULT 0,
  FOREIGN KEY (attribution_id) REFERENCES attribution_links(id)
);

CREATE INDEX IF NOT EXISTS idx_user_attribution_attribution ON user_attribution(attribution_id);

-- Seed common marketing links
INSERT OR IGNORE INTO attribution_links (id, source, campaign, creator) VALUES
('twitter-thread-feb20', 'twitter', 'thread-feb20', 'main'),
('reddit-sideproject-feb20', 'reddit', 'sideproject-feb20', 'main'),
('reddit-india-feb20', 'reddit', 'india-feb20', 'main'),
('discord-automation-feb20', 'discord', 'automation-feb20', 'main'),
('manual-friend-1', 'manual', 'friend', 'friend-1'),
('manual-friend-2', 'manual', 'friend', 'friend-2'),
('manual-friend-3', 'manual', 'friend', 'friend-3');
