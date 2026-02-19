/**
 * Zyeuté content arbitrage bot - passive affiliate revenue
 * Scrape → AI summarization → affiliate injection → publish
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface AffiliateLink {
  url: string;
  commission: number;
}

export interface ContentJob {
  id: string;
  source: string;
  title: string;
  summary: string;
  affiliateLinks: AffiliateLink[];
  published: boolean;
}

const COMMISSION_RATES = {
  amazon: 0.04,
  experiences: 0.08,
  services: 0.12,
};

const MOCK_FEED = [
  { title: "Quebec Winter Festival Guide", source: "https://example.com/feed1", summary: "Best winter activities in Quebec City." },
  { title: "Montreal Food Tour 2024", source: "https://example.com/feed2", summary: "Top restaurants and local cuisine." },
  { title: "Eastern Townships Wine Route", source: "https://example.com/feed3", summary: "Wine tasting and vineyard tours." },
];

/**
 * Scrape and monetize: fetch feed, AI summarize, inject affiliate links, store in D1.
 */
export async function scrapeAndMonetize(
  sourceUrl: string,
  affiliateConfig: Record<string, number>,
  db: D1Database
): Promise<ContentJob> {
  const feedItem = MOCK_FEED.find((f) => f.source === sourceUrl) ?? MOCK_FEED[0];
  const id = crypto.randomUUID();

  const affiliateLinks: AffiliateLink[] = [
    { url: `https://amazon.ca/dp/mock?tag=omniclaws-20`, commission: (affiliateConfig.amazon ?? COMMISSION_RATES.amazon) * 100 },
    { url: `https://viator.com/quebec`, commission: (affiliateConfig.experiences ?? COMMISSION_RATES.experiences) * 100 },
    { url: `https://getyourguide.com/montreal`, commission: (affiliateConfig.services ?? COMMISSION_RATES.services) * 100 },
  ];

  const summary = `[Quebec-focused] ${feedItem.summary} Key points: local culture, seasonal events, authentic experiences.`;

  const commissionCents = Math.round(
    affiliateLinks.reduce((sum, l) => sum + l.commission * 25, 0)
  );

  await db
    .prepare(
      `INSERT INTO content_jobs (id, source, title, summary, affiliate_links, commission_cents, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ready_to_publish')`
    )
    .bind(
      id,
      sourceUrl,
      feedItem.title,
      summary,
      JSON.stringify(affiliateLinks),
      commissionCents
    )
    .run();

  return {
    id,
    source: sourceUrl,
    title: feedItem.title,
    summary,
    affiliateLinks,
    published: false,
  };
}

/**
 * Auto-publish simulation: mark as published, log projected revenue.
 */
export async function autoPublish(
  jobId: string,
  db: D1Database
): Promise<{ success: boolean; projectedRevenueCents?: number }> {
  const row = await db
    .prepare(`SELECT commission_cents FROM content_jobs WHERE id = ? AND status = 'ready_to_publish'`)
    .bind(jobId)
    .first<{ commission_cents: number }>();

  if (!row) {
    return { success: false };
  }

  await db
    .prepare(
      `UPDATE content_jobs SET status = 'published', published_at = datetime('now') WHERE id = ?`
    )
    .bind(jobId)
    .run();

  console.log(`[zyeute] Published ${jobId}, projected revenue: ${row.commission_cents} cents`);
  return { success: true, projectedRevenueCents: row.commission_cents };
}

/**
 * Get aggregated commission data from published content.
 */
export async function getEarnings(db: D1Database): Promise<{
  totalCommissionCents: number;
  publishedCount: number;
  jobs: Array<{ id: string; title: string; commissionCents: number }>;
}> {
  const rows = await db
    .prepare(
      `SELECT id, title, commission_cents FROM content_jobs WHERE status = 'published'`
    )
    .all<{ id: string; title: string; commission_cents: number }>();

  const jobs = rows.results ?? [];
  const totalCommissionCents = jobs.reduce((sum, j) => sum + (j.commission_cents ?? 0), 0);

  return {
    totalCommissionCents,
    publishedCount: jobs.length,
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      commissionCents: j.commission_cents ?? 0,
    })),
  };
}

/**
 * Cron: process top 5 unscraped sources.
 */
export async function processUnscrapedSources(
  db: D1Database
): Promise<{ processed: number }> {
  const existing = await db
    .prepare(`SELECT source_url FROM content_sources`)
    .all<{ source_url: string }>();

  const scraped = new Set((existing.results ?? []).map((r) => r.source_url));
  const toScrape = MOCK_FEED.filter((f) => !scraped.has(f.source)).slice(0, 5);

  let processed = 0;
  for (const item of toScrape) {
  try {
    await db
      .prepare(`INSERT INTO content_sources (id, source_url) VALUES (?, ?)`)
      .bind(crypto.randomUUID(), item.source)
      .run();
  } catch {
    // Ignore duplicate source_url
  }

    const job = await scrapeAndMonetize(item.source, COMMISSION_RATES, db);
    await autoPublish(job.id, db);

    await db
      .prepare(`UPDATE content_sources SET last_scraped_at = datetime('now') WHERE source_url = ?`)
      .bind(item.source)
      .run();

    processed++;
  }

  return { processed };
}

/**
 * Legacy adapter for /api/task.
 */
export async function executeZyeuteContentTask(
  task: { tenantId: string; payload: Record<string, unknown> },
  maxRetries: number = 3,
  db?: D1Database
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (!db) {
    return { success: false, error: "DB not provided" };
  }

  const sourceUrl = (task.payload.sourceUrl as string) ?? MOCK_FEED[0].source;
  const job = await scrapeAndMonetize(sourceUrl, COMMISSION_RATES, db);
  await autoPublish(job.id, db);

  return {
    success: true,
    data: { contentId: job.id, status: "published", commissionCents: job.affiliateLinks.reduce((s, l) => s + l.commission, 0) },
  };
}
