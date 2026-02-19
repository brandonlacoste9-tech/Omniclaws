/**
 * Nevermined-style micro-transactions: $0.05/task with sub-cent precision
 * Reserve → Confirm/Release pattern prevents billing for failed tasks
 * flushCharges: Real Stripe/Paddle via processPayment
 */

import type { D1Database } from "@cloudflare/workers-types";
import { processPayment } from "./router";
import type { Env } from "../types";

const TASK_PRICE_CENTS = 5;
const FLUSH_THRESHOLD_CENTS = 100; // Batch bill at $1.00

export type LedgerStatus = "reserved" | "confirmed" | "failed" | "processed";

export interface ReserveResult {
  success: boolean;
  reservationId?: string;
  error?: string;
}

export interface ConfirmResult {
  success: boolean;
  error?: string;
}

export interface ReleaseResult {
  success: boolean;
  error?: string;
}

export interface FlushResult {
  success: boolean;
  amountCents?: number;
  chargeCount?: number;
  error?: string;
}

/**
 * Reserve funds for a task. Idempotent via unique reservationId.
 */
export async function reserveFunds(
  db: D1Database,
  userId: string,
  taskId: string,
  amountCents: number = TASK_PRICE_CENTS
): Promise<ReserveResult> {
  const reservationId = crypto.randomUUID();

  try {
    const result = await db
      .prepare(
        `INSERT INTO usage_ledger (reservation_id, user_id, task_id, amount_cents, status)
         VALUES (?, ?, ?, ?, 'reserved')`
      )
      .bind(reservationId, userId, taskId, amountCents)
      .run();

    if (result.meta.changes === 0) {
      return { success: false, error: "Insert failed (no rows affected)" };
    }

    return { success: true, reservationId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE") || message.includes("SQLITE_CONSTRAINT")) {
      return { success: false, error: "Duplicate reservationId" };
    }
    return { success: false, error: message };
  }
}

/**
 * Confirm charge after successful task execution.
 * Credits referrer with 20% commission when spender was referred.
 */
export async function confirmCharge(
  db: D1Database,
  reservationId: string,
  env?: Env
): Promise<ConfirmResult> {
  const row = await db
    .prepare(`SELECT user_id, amount_cents FROM usage_ledger WHERE reservation_id = ? AND status = 'reserved'`)
    .bind(reservationId)
    .first<{ user_id: string; amount_cents: number }>();

  if (!row) {
    return { success: false, error: "Reservation not found or already processed" };
  }

  try {
    const result = await db
      .prepare(
        `UPDATE usage_ledger SET status = 'confirmed', updated_at = datetime('now')
         WHERE reservation_id = ? AND status = 'reserved'`
      )
      .bind(reservationId)
      .run();

    if (result.meta.changes === 0) {
      return { success: false, error: "Reservation not found or already processed" };
    }

    if (env) {
      const { creditReferrer } = await import("../referrals/referral-system");
      await creditReferrer(row.user_id, row.amount_cents, db, env);
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Release reservation on task failure.
 */
export async function releaseReservation(
  db: D1Database,
  reservationId: string
): Promise<ReleaseResult> {
  try {
    await db
      .prepare(
        `UPDATE usage_ledger SET status = 'failed', updated_at = datetime('now')
         WHERE reservation_id = ? AND status = 'reserved'`
      )
      .bind(reservationId)
      .run();

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Flush confirmed charges >= $1.00 to Stripe/Paddle via processPayment.
 * Only marks as 'processed' after successful payment. On failure, keeps
 * status 'confirmed' for retry on next flush (idempotent).
 */
export async function flushCharges(
  db: D1Database,
  userId: string,
  env: Env
): Promise<FlushResult> {
  try {
    const rows = await db
      .prepare(
        `SELECT reservation_id, amount_cents FROM usage_ledger
         WHERE user_id = ? AND status = 'confirmed'
         ORDER BY created_at`
      )
      .bind(userId)
      .all<{ reservation_id: string; amount_cents: number }>();

    const charges = rows.results ?? [];
    const totalCents = charges.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);

    if (totalCents < FLUSH_THRESHOLD_CENTS) {
      return { success: true, amountCents: totalCents, chargeCount: 0 };
    }

    const countryRow = await db
      .prepare(`SELECT country FROM billing_customers WHERE user_id = ?`)
      .bind(userId)
      .first<{ country: string }>();

    const country = countryRow?.country ?? "US";

    const payment = await processPayment(userId, totalCents, country, env);

    if (!payment.success) {
      return {
        success: false,
        amountCents: totalCents,
        chargeCount: charges.length,
        error: payment.error,
      };
    }

    for (const charge of charges) {
      await db
        .prepare(
          `UPDATE usage_ledger SET status = 'processed', processed_at = datetime('now')
           WHERE reservation_id = ? AND status = 'confirmed'`
        )
        .bind(charge.reservation_id)
        .run();
    }

    return {
      success: true,
      amountCents: totalCents,
      chargeCount: charges.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Force flush confirmed charges to Stripe/Paddle (bypasses $1 threshold).
 * Use for testing or admin-triggered immediate billing.
 */
export async function forceFlushCharges(
  db: D1Database,
  userId: string,
  env: Env
): Promise<FlushResult> {
  const rows = await db
    .prepare(
      `SELECT reservation_id, amount_cents FROM usage_ledger
       WHERE user_id = ? AND status = 'confirmed'
       ORDER BY created_at`
    )
    .bind(userId)
    .all<{ reservation_id: string; amount_cents: number }>();

  const charges = rows.results ?? [];
  const totalCents = charges.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);

  if (totalCents === 0) {
    return { success: true, amountCents: 0, chargeCount: 0 };
  }

  const countryRow = await db
    .prepare(`SELECT country FROM billing_customers WHERE user_id = ?`)
    .bind(userId)
    .first<{ country: string }>();

  const country = countryRow?.country ?? "US";

  const payment = await processPayment(userId, totalCents, country, env);

  if (!payment.success) {
    return {
      success: false,
      amountCents: totalCents,
      chargeCount: charges.length,
      error: payment.error,
    };
  }

  for (const charge of charges) {
    await db
      .prepare(
        `UPDATE usage_ledger SET status = 'processed', processed_at = datetime('now')
         WHERE reservation_id = ? AND status = 'confirmed'`
      )
      .bind(charge.reservation_id)
      .run();
  }

  return {
    success: true,
    amountCents: totalCents,
    chargeCount: charges.length,
  };
}
