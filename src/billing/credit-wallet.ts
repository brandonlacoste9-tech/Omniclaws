/**
 * Credit Wallet: Buy packs, spend credits
 * Avoids Stripe micro-transaction fees (97% margin vs 67%)
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";

const FREE_DAILY_LIMIT = 50;

export const CREDIT_PACKS = {
  starter: { credits: 5, priceCents: 500, name: "Starter Pack" },
  pro: { credits: 10, priceCents: 1000, name: "Pro Pack" },
  whale: { credits: 55, priceCents: 5000, name: "Whale Pack (Bonus)" },
} as const;

export type PackType = keyof typeof CREDIT_PACKS;

export interface DailyLimitResult {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
  reason?: string;
}

export interface CreditBalanceResult {
  creditBalance: number;
  freeTasksUsed: number;
  freeTasksRemaining: number;
  freeTasksLimit: number;
}

/**
 * Get today's date in UTC (YYYY-MM-DD).
 */
function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check daily free limit. Resets at midnight UTC.
 */
export async function checkDailyLimit(
  userId: string,
  db: D1Database
): Promise<DailyLimitResult> {
  const today = getTodayUTC();

  let row = await db
    .prepare(
      `SELECT free_tasks_used_today, last_reset_date FROM user_credits WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ free_tasks_used_today: number; last_reset_date: string | null }>();

  if (!row) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_credits (user_id, credit_balance, free_tasks_used_today, last_reset_date)
         VALUES (?, 0, 0, ?)`
      )
      .bind(userId, today)
      .run();
    row = await db
      .prepare(`SELECT free_tasks_used_today, last_reset_date FROM user_credits WHERE user_id = ?`)
      .bind(userId)
      .first<{ free_tasks_used_today: number; last_reset_date: string | null }>();
  }

  let used = 0;
  if (row && row.last_reset_date === today) {
    used = row.free_tasks_used_today ?? 0;
  } else {
    await db
      .prepare(
        `UPDATE user_credits SET free_tasks_used_today = 0, last_reset_date = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .bind(today, userId)
      .run();
  }

  const remaining = Math.max(0, FREE_DAILY_LIMIT - used);

  if (used >= FREE_DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      used,
      limit: FREE_DAILY_LIMIT,
      reason: "Daily free limit reached. Buy credits for $5 to continue.",
    };
  }

  return {
    allowed: true,
    remaining,
    used,
    limit: FREE_DAILY_LIMIT,
  };
}

/**
 * Increment free tasks used. Call after successful free task.
 */
export async function incrementFreeTasksUsed(
  userId: string,
  db: D1Database
): Promise<void> {
  const today = getTodayUTC();

  await db
    .prepare(
      `INSERT INTO user_credits (user_id, credit_balance, free_tasks_used_today, last_reset_date)
         VALUES (?, 0, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           free_tasks_used_today = CASE WHEN last_reset_date != ? THEN 1 ELSE free_tasks_used_today + 1 END,
           last_reset_date = ?,
           updated_at = datetime('now')`
    )
    .bind(userId, today, today, today)
    .run();
}

/**
 * Get or create user credits row, ensure reset if new day.
 */
async function ensureUserCredits(userId: string, db: D1Database): Promise<{
  creditBalance: number;
  freeTasksUsed: number;
  lastResetDate: string | null;
}> {
  const today = getTodayUTC();

  let row = await db
    .prepare(
      `SELECT credit_balance, free_tasks_used_today, last_reset_date FROM user_credits WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ credit_balance: number; free_tasks_used_today: number; last_reset_date: string | null }>();

  if (!row) {
    await db
      .prepare(
        `INSERT INTO user_credits (user_id, credit_balance, free_tasks_used_today, last_reset_date)
         VALUES (?, 0, 0, ?)`
      )
      .bind(userId, today)
      .run();
    return { creditBalance: 0, freeTasksUsed: 0, lastResetDate: today };
  }

  if (row.last_reset_date !== today) {
    await db
      .prepare(
        `UPDATE user_credits SET free_tasks_used_today = 0, last_reset_date = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .bind(today, userId)
      .run();
    return {
      creditBalance: row.credit_balance ?? 0,
      freeTasksUsed: 0,
      lastResetDate: today,
    };
  }

  return {
    creditBalance: row.credit_balance ?? 0,
    freeTasksUsed: row.free_tasks_used_today ?? 0,
    lastResetDate: row.last_reset_date,
  };
}

/**
 * Deduct credits. Returns true if successful.
 */
export async function deductCredits(
  userId: string,
  amount: number,
  db: D1Database
): Promise<{ success: boolean; error?: string }> {
  const row = await db
    .prepare(`SELECT credit_balance FROM user_credits WHERE user_id = ?`)
    .bind(userId)
    .first<{ credit_balance: number }>();

  const balance = row?.credit_balance ?? 0;
  if (balance < amount) {
    return { success: false, error: "Insufficient credits. Buy more at /billing/purchase-credits" };
  }

  await db
    .prepare(
      `UPDATE user_credits SET credit_balance = credit_balance - ?, updated_at = datetime('now')
       WHERE user_id = ? AND credit_balance >= ?`
    )
    .bind(amount, userId, amount)
    .run();

  return { success: true };
}

/**
 * Add credits (e.g. after purchase webhook).
 */
export async function addCredits(
  userId: string,
  amount: number,
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_credits (user_id, credit_balance, free_tasks_used_today, last_reset_date)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         credit_balance = credit_balance + excluded.credit_balance,
         updated_at = datetime('now')`
    )
    .bind(userId, amount, getTodayUTC())
    .run();
}

/**
 * Get user's credit balance and free task usage.
 */
export async function getCreditBalance(
  userId: string,
  db: D1Database
): Promise<CreditBalanceResult> {
  const limit = await checkDailyLimit(userId, db);
  const row = await db
    .prepare(`SELECT credit_balance FROM user_credits WHERE user_id = ?`)
    .bind(userId)
    .first<{ credit_balance: number }>();

  return {
    creditBalance: row?.credit_balance ?? 0,
    freeTasksUsed: limit.used,
    freeTasksRemaining: limit.remaining,
    freeTasksLimit: FREE_DAILY_LIMIT,
  };
}
