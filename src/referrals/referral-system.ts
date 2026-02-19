/**
 * Referral system: 20% commission on referred users' lifetime spending
 * Viral loop: users become salespeople
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";

const COMMISSION_RATE = 0.2;
const MIN_WITHDRAWAL_CENTS = 1000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length: number = 8): string {
  let code = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[bytes[i]! % CODE_CHARS.length];
  }
  return code;
}

/**
 * Generate 8-char referral code. Idempotent: returns existing if user has one.
 */
export async function generateReferralCode(
  userId: string,
  db: D1Database,
  baseUrl: string = "https://omniclaws.io"
): Promise<{ success: boolean; code?: string; shareUrl?: string; error?: string }> {
  const existing = await db
    .prepare(`SELECT code FROM referral_codes WHERE user_id = ?`)
    .bind(userId)
    .first<{ code: string }>();

  if (existing) {
    return {
      success: true,
      code: existing.code,
      shareUrl: `${baseUrl}/?ref=${existing.code}`,
    };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(8);
    try {
      await db
        .prepare(
          `INSERT INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)`
        )
        .bind(crypto.randomUUID(), userId, code)
        .run();

      return {
        success: true,
        code,
        shareUrl: `${baseUrl}/?ref=${code}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE") || msg.includes("SQLITE_CONSTRAINT")) {
        continue;
      }
      return { success: false, error: msg };
    }
  }

  return { success: false, error: "Failed to generate unique code" };
}

/**
 * Track referral. Idempotent: calling twice with same user does not double-count.
 */
export async function trackReferral(
  referrerCode: string,
  newUserId: string,
  db: D1Database
): Promise<{ success: boolean; error?: string }> {
  const codeRow = await db
    .prepare(`SELECT id, user_id FROM referral_codes WHERE code = ?`)
    .bind(referrerCode.toUpperCase())
    .first<{ id: string; user_id: string }>();

  if (!codeRow) {
    return { success: false, error: "Invalid referral code" };
  }

  if (codeRow.user_id === newUserId) {
    return { success: false, error: "Cannot refer yourself" };
  }

  const existing = await db
    .prepare(`SELECT 1 FROM referral_links WHERE user_id = ?`)
    .bind(newUserId)
    .first();

  if (existing) {
    return { success: true };
  }

  try {
    await db
      .prepare(
        `INSERT INTO referral_links (user_id, referral_code_id) VALUES (?, ?)`
      )
      .bind(newUserId, codeRow.id)
      .run();

    await db
      .prepare(
        `UPDATE referral_codes SET total_referrals = total_referrals + 1 WHERE id = ?`
      )
      .bind(codeRow.id)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("SQLITE_CONSTRAINT")) {
      return { success: true };
    }
    return { success: false, error: msg };
  }

  return { success: true };
}

/**
 * Credit referrer with 20% commission when referred user spends.
 */
export async function creditReferrer(
  spenderUserId: string,
  amountCents: number,
  db: D1Database,
  _env: Env
): Promise<void> {
  const link = await db
    .prepare(
      `SELECT rl.referral_code_id, rc.user_id as referrer_id
       FROM referral_links rl
       JOIN referral_codes rc ON rl.referral_code_id = rc.id
       WHERE rl.user_id = ?`
    )
    .bind(spenderUserId)
    .first<{ referral_code_id: string; referrer_id: string }>();

  if (!link) return;

  const commissionCents = Math.floor(amountCents * COMMISSION_RATE);
  if (commissionCents < 1) return;

  const ledgerId = crypto.randomUUID();

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO referral_ledger (id, referrer_id, spender_id, amount_cents, referral_code_id)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(ledgerId, link.referrer_id, spenderUserId, commissionCents, link.referral_code_id),
      db.prepare(
        `INSERT INTO referrer_balances (user_id, balance_cents, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           balance_cents = balance_cents + excluded.balance_cents,
           updated_at = datetime('now')`
      ).bind(link.referrer_id, commissionCents),
      db.prepare(
        `UPDATE referral_codes SET total_earnings_cents = total_earnings_cents + ? WHERE id = ?`
      ).bind(commissionCents, link.referral_code_id),
    ]);
  } catch (err) {
    console.error("[referral] creditReferrer failed:", err);
  }
}

/**
 * Get referral stats for user.
 */
export async function getReferralStats(
  userId: string,
  db: D1Database,
  baseUrl: string = "https://omniclaws.io"
): Promise<{
  found: boolean;
  code?: string;
  totalReferrals?: number;
  totalEarningsCents?: number;
  shareUrl?: string;
}> {
  const row = await db
    .prepare(`SELECT code, total_referrals, total_earnings_cents FROM referral_codes WHERE user_id = ?`)
    .bind(userId)
    .first<{ code: string; total_referrals: number; total_earnings_cents: number }>();

  if (!row) return { found: false };

  return {
    found: true,
    code: row.code,
    totalReferrals: row.total_referrals ?? 0,
    totalEarningsCents: row.total_earnings_cents ?? 0,
    shareUrl: `${baseUrl}/?ref=${row.code}`,
  };
}

/**
 * Get withdrawable balance.
 */
export async function getReferralBalance(
  userId: string,
  db: D1Database
): Promise<{ balanceCents: number }> {
  const row = await db
    .prepare(`SELECT balance_cents FROM referrer_balances WHERE user_id = ?`)
    .bind(userId)
    .first<{ balance_cents: number }>();

  return { balanceCents: row?.balance_cents ?? 0 };
}

/**
 * Withdraw balance. Minimum $10.
 * MVP: Deducts balance, creates withdrawal record. Actual payout via Stripe Connect later.
 */
export async function withdrawReferralBalance(
  userId: string,
  db: D1Database
): Promise<{ success: boolean; amountCents?: number; error?: string }> {
  const row = await db
    .prepare(`SELECT balance_cents FROM referrer_balances WHERE user_id = ?`)
    .bind(userId)
    .first<{ balance_cents: number }>();

  const balanceCents = row?.balance_cents ?? 0;
  if (balanceCents < MIN_WITHDRAWAL_CENTS) {
    return {
      success: false,
      error: `Minimum withdrawal $${MIN_WITHDRAWAL_CENTS / 100}. Balance: $${(balanceCents / 100).toFixed(2)}`,
    };
  }

  await db
    .prepare(
      `UPDATE referrer_balances SET balance_cents = 0, updated_at = datetime('now') WHERE user_id = ?`
    )
    .bind(userId)
    .run();

  await db
    .prepare(
      `INSERT INTO referral_withdrawals (id, user_id, amount_cents, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`
    )
    .bind(crypto.randomUUID(), userId, balanceCents)
    .run();

  return { success: true, amountCents: balanceCents };
}
