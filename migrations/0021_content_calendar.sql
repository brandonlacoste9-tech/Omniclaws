-- Content calendar for manual posting organization

CREATE TABLE IF NOT EXISTS content_calendar (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  content_type TEXT,
  title TEXT,
  body TEXT,
  angle TEXT,
  scheduled_date DATE,
  posted_date DATE,
  posted INTEGER DEFAULT 0,
  attribution_link TEXT,
  engagement_score INTEGER,
  clicks INTEGER,
  conversions INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_calendar_platform ON content_calendar(platform);
CREATE INDEX IF NOT EXISTS idx_content_calendar_scheduled ON content_calendar(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_content_calendar_posted ON content_calendar(posted);

-- Seed initial content ideas
INSERT OR IGNORE INTO content_calendar (id, platform, content_type, title, body, angle, scheduled_date) VALUES
('twitter-1', 'twitter', 'thread', 'Pricing transparency thread', 'I was paying $500/month to OpenAI. Built my own automation platform instead. 14 regions, local pricing. 50 free tasks/day. No signup. Runs on your own AI (Ollama).', 'pricing', date('now')),
('reddit-1', 'reddit', 'post', 'Show HN: Omniclaws', 'Built this over weekend. 50 free automation tasks/day. Runs on Ollama. 14 regional sites with PPP pricing.', 'story', date('now')),
('reddit-2', 'reddit', 'comment', 'SideProject advice', 'I automated my automation. Omniclaws - 50 free tasks/day, runs on your hardware.', 'features', date('now', '+1 day')),
('twitter-2', 'twitter', 'post', 'India pricing', '₹33 per task. Cheaper than chai. omniclaws.brandonlacoste9.workers.dev/?region=india', 'pricing', date('now', '+1 day'));
