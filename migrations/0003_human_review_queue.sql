-- EU AI Act Article 6: Human review queue for high-risk recruitment decisions
-- Annex III: Employment automation requires human oversight when confidence < 0.95

CREATE TABLE IF NOT EXISTS human_review_queue (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT,
  confidence_score REAL NOT NULL,
  rationale TEXT,
  reviewer_assigned TEXT,
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_human_review_tenant ON human_review_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_human_review_created ON human_review_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_human_review_task ON human_review_queue(task_id);
