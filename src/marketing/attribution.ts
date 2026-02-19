/**
 * Attribution tracking: measure manual marketing (clicks, signups, conversions, revenue)
 */

import type { D1Database } from "@cloudflare/workers-types";

const BASE_URL = "https://omniclaws.brandonlacoste9.workers.dev";
const COOKIE_NAME = "omniclaws_ref";
const COOKIE_DAYS = 30;

export interface AttributionLink {
  id: string;
  source: string;
  campaign: string | null;
  creator: string | null;
  created_at: number;
  clicks: number;
  signups: number;
  conversions: number;
  revenue_cents: number;
}

export interface AttributionDashboard {
  sources: Array<{
    source: string;
    clicks: number;
    signups: number;
    conversions: number;
    revenue: number;
  }>;
  bestPerforming: string;
  totalRevenueAttributed: number;
}

/**
 * Generate attribution link. Idempotent: returns existing if id exists.
 */
export async function generateAttributionLink(
  source: string,
  campaign: string | null,
  creator: string | null,
  db: D1Database,
  baseUrl: string = BASE_URL
): Promise<{ success: boolean; url?: string; id?: string; error?: string }> {
  const id = [source, campaign ?? "default", creator ?? "anon"]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!id) {
    return { success: false, error: "Invalid source/campaign/creator" };
  }

  try {
    await db
      .prepare(
        `INSERT INTO attribution_links (id, source, campaign, creator) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .bind(id, source, campaign ?? null, creator ?? null)
      .run();

    const url = `${baseUrl}/?ref=${id}`;
    return { success: true, url, id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hash IP for privacy-safe logging.
 */
function hashForPrivacy(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) - h + value.charCodeAt(i);
    h = h & h;
  }
  return `h${Math.abs(h).toString(16)}`;
}

/**
 * Track click: increment attribution link, log event. Call when user hits URL with ?ref=
 */
export async function trackClick(
  refCode: string,
  request: Request,
  db: D1Database,
  userId?: string
): Promise<{ success: boolean; isAttribution?: boolean }> {
  const row = await db
    .prepare("SELECT id FROM attribution_links WHERE id = ?")
    .bind(refCode)
    .first<{ id: string }>();

  if (!row) return { success: true, isAttribution: false };

  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const ipHash = hashForPrivacy(ip);
  const ua = request.headers.get("user-agent") ?? "";

  try {
    await db
      .prepare("UPDATE attribution_links SET clicks = clicks + 1 WHERE id = ?")
      .bind(refCode)
      .run();

    await db
      .prepare(
        `INSERT INTO click_events (id, attribution_id, user_id, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), refCode, userId ?? null, ipHash, ua.slice(0, 500))
      .run();

    return { success: true, isAttribution: true };
  } catch (err) {
    return { success: false, isAttribution: true };
  }
}

/**
 * Record first-touch attribution for a user. Call when user first uses API with ref.
 */
export async function recordUserAttribution(
  userId: string,
  refCode: string,
  db: D1Database
): Promise<{ success: boolean; isAttribution?: boolean }> {
  const link = await db
    .prepare("SELECT id FROM attribution_links WHERE id = ?")
    .bind(refCode)
    .first<{ id: string }>();

  if (!link) return { success: true, isAttribution: false };

  try {
    const existing = await db
      .prepare("SELECT attribution_id FROM user_attribution WHERE user_id = ?")
      .bind(userId)
      .first<{ attribution_id: string }>();

    if (existing) return { success: true, isAttribution: true };

    await db
      .prepare(
        `INSERT INTO user_attribution (user_id, attribution_id) VALUES (?, ?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .bind(userId, refCode)
      .run();

    const inserted = await db
      .prepare("SELECT 1 FROM user_attribution WHERE user_id = ? AND attribution_id = ?")
      .bind(userId, refCode)
      .first();

    if (inserted) {
      await db
        .prepare("UPDATE attribution_links SET signups = signups + 1 WHERE id = ?")
        .bind(refCode)
        .run();
    }

    return { success: true, isAttribution: true };
  } catch (err) {
    return { success: false, isAttribution: true };
  }
}

/**
 * Attribute conversion (purchase). Call when user buys credits.
 */
export async function attributeConversion(
  userId: string,
  refCode: string | null,
  revenueCents: number,
  db: D1Database
): Promise<{ success: boolean }> {
  let attributionId = refCode;

  if (!attributionId) {
    const ua = await db
      .prepare("SELECT attribution_id FROM user_attribution WHERE user_id = ?")
      .bind(userId)
      .first<{ attribution_id: string }>();
    attributionId = ua?.attribution_id ?? null;
  }

  if (!attributionId) return { success: true };

  const link = await db
    .prepare("SELECT id FROM attribution_links WHERE id = ?")
    .bind(attributionId)
    .first<{ id: string }>();

  if (!link) return { success: true };

  try {
    const uaRow = await db
      .prepare("SELECT converted FROM user_attribution WHERE user_id = ? AND attribution_id = ?")
      .bind(userId, attributionId)
      .first<{ converted: number }>();

    const isFirstConversion = !uaRow || uaRow.converted === 0;

    await db
      .prepare(
        `UPDATE attribution_links SET revenue_cents = revenue_cents + ?, conversions = conversions + ? WHERE id = ?`
      )
      .bind(revenueCents, isFirstConversion ? 1 : 0, attributionId)
      .run();

    if (isFirstConversion) {
      await db
        .prepare("UPDATE user_attribution SET converted = 1 WHERE user_id = ? AND attribution_id = ?")
        .bind(userId, attributionId)
        .run();
    }

    return { success: true };
  } catch (err) {
    return { success: false };
  }
}

/**
 * Check if ref is an attribution link (vs user referral code).
 */
export async function isAttributionLink(refCode: string, db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM attribution_links WHERE id = ?")
    .bind(refCode)
    .first();
  return !!row;
}

/**
 * Get attribution dashboard for admin.
 */
export async function getAttributionDashboard(db: D1Database): Promise<AttributionDashboard> {
  const rows = await db
    .prepare(
      `SELECT source, SUM(clicks) as clicks, SUM(signups) as signups, SUM(conversions) as conversions, SUM(revenue_cents) as revenue_cents
       FROM attribution_links GROUP BY source`
    )
    .all<{ source: string; clicks: number; signups: number; conversions: number; revenue_cents: number }>();

  const sources = (rows.results ?? []).map((r) => ({
    source: r.source,
    clicks: r.clicks ?? 0,
    signups: r.signups ?? 0,
    conversions: r.conversions ?? 0,
    revenue: r.revenue_cents ?? 0,
  }));

  const best = sources.length
    ? sources.reduce((a, b) => (a.revenue >= b.revenue ? a : b), sources[0]!)
    : null;
  const totalRevenueAttributed = sources.reduce((s, x) => s + x.revenue, 0);

  return {
    sources,
    bestPerforming: best?.source ?? "none",
    totalRevenueAttributed,
  };
}

/**
 * Cookie header for attribution persistence (30 days).
 */
export function attributionCookieHeader(refCode: string): string {
  const maxAge = COOKIE_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${refCode}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
