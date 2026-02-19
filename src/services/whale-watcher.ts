/**
 * WhaleWatcher - Blockchain transaction monitoring
 * Alerts traders when >$100k moves on BTC/ETH
 * $0.10 per alert via usage-meter
 * MVP simulation mode until ALCHEMY_API_KEY added
 */

import type { D1Database } from "@cloudflare/workers-types";
import { reserveFunds, confirmCharge, releaseReservation, flushCharges } from "../billing/usage-meter";
import type { Env } from "../types";

const WHALE_ALERT_CENTS = 10;
const RATE_LIMIT_ALERTS_PER_HOUR = 100;

export interface WhaleAlert {
  chain: "btc" | "eth";
  txHash: string;
  from: string;
  to: string;
  valueUsd: number;
  timestamp: number;
}

export interface Subscription {
  userId: string;
  chain: "btc" | "eth";
  minValueUsd: number;
  webhookUrl?: string;
  email?: string;
  tenantId?: string;
}

const MOCK_PRICES = { btc: 65000, eth: 3500 };

/**
 * Parse transaction value to USD.
 * ETH: valueWei. BTC: valueSat or valueUsd (from Blockchair).
 */
export function detectWhale(
  chain: "btc" | "eth",
  txData: {
    valueWei?: string;
    valueSat?: number;
    valueUsd?: number;
    from?: string;
    to?: string;
    hash?: string;
    timestamp?: number;
  },
  minValueUsd: number = 100000
): WhaleAlert | null {
  const price = chain === "btc" ? MOCK_PRICES.btc : MOCK_PRICES.eth;
  let valueUsd: number;

  if (txData.valueUsd !== undefined && txData.valueUsd > 0) {
    valueUsd = txData.valueUsd;
  } else if (chain === "eth" && txData.valueWei) {
    const wei = BigInt(txData.valueWei);
    const eth = Number(wei) / 1e18;
    valueUsd = eth * price;
  } else if (chain === "btc" && txData.valueSat !== undefined) {
    const btc = txData.valueSat / 1e8;
    valueUsd = btc * price;
  } else {
    return null;
  }

  if (valueUsd < minValueUsd) return null;

  return {
    chain,
    txHash: txData.hash ?? crypto.randomUUID().slice(0, 18),
    from: txData.from ?? (chain === "btc" ? "unknown" : "0xunknown"),
    to: txData.to ?? "",
    valueUsd,
    timestamp: txData.timestamp ?? Date.now(),
  };
}

/**
 * Check rate limit: max 100 alerts per user per hour.
 */
async function checkRateLimit(db: D1Database, userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM whale_deliveries
       WHERE user_id = ? AND delivered_at >= ? AND status = 'delivered'`
    )
    .bind(userId, oneHourAgo)
    .first<{ cnt: number }>();

  return (row?.cnt ?? 0) >= RATE_LIMIT_ALERTS_PER_HOUR;
}

/**
 * Process whale alert: charge subscribers, send webhooks, log deliveries.
 */
export async function processWhaleAlert(
  alert: WhaleAlert,
  db: D1Database,
  env: Env
): Promise<{ delivered: number; skipped: number }> {
  const alertId = crypto.randomUUID();

  try {
    await db
      .prepare(
        `INSERT INTO whale_alerts (id, chain, tx_hash, from_address, to_address, value_usd)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(alertId, alert.chain, alert.txHash, alert.from, alert.to, alert.valueUsd)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("tx_hash")) {
      return { delivered: 0, skipped: 0 };
    }
    throw err;
  }

  const subs = await db
    .prepare(
      `SELECT id, user_id, webhook_url, tenant_id FROM whale_subscriptions
       WHERE chain = ? AND min_value_usd <= ? AND active = 1`
    )
    .bind(alert.chain, alert.valueUsd)
    .all<{ id: string; user_id: string; webhook_url: string | null; tenant_id: string | null }>();

  let delivered = 0;
  let skipped = 0;
  const chargedUserIds = new Set<string>();

  for (const sub of subs.results ?? []) {
    const rateLimited = await checkRateLimit(db, sub.user_id);
    if (rateLimited) {
      skipped++;
      continue;
    }

    const tenantId = sub.tenant_id ?? "omniclaws";
    const tenantRow = await db
      .prepare("SELECT pricing_multiplier FROM tenant_configs WHERE id = ?")
      .bind(tenantId)
      .first<{ pricing_multiplier: number }>();
    const multiplier = tenantRow?.pricing_multiplier ?? 1.0;
    const alertCents = Math.round(WHALE_ALERT_CENTS * multiplier);

    const deliveryId = crypto.randomUUID();
    const reserve = await reserveFunds(db, sub.user_id, deliveryId, alertCents);

    if (!reserve.success) {
      await db
        .prepare(
          `INSERT INTO whale_deliveries (id, alert_id, user_id, status, error_message)
           VALUES (?, ?, ?, 'failed', ?)`
        )
        .bind(deliveryId, alertId, sub.user_id, reserve.error)
        .run();
      skipped++;
      continue;
    }

    let webhookOk = true;
    if (sub.webhook_url) {
      try {
        const res = await fetch(sub.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alert),
        });
        if (!res.ok) {
          const retryRes = await fetch(sub.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(alert),
          });
          webhookOk = retryRes.ok;
        }
      } catch (err) {
        webhookOk = false;
      }
    }

    if (webhookOk || !sub.webhook_url) {
      await confirmCharge(db, reserve.reservationId!, env);
      await db
        .prepare(
          `INSERT INTO whale_deliveries (id, alert_id, user_id, delivered_at, status)
           VALUES (?, ?, ?, datetime('now'), 'delivered')`
        )
        .bind(deliveryId, alertId, sub.user_id)
        .run();

      await db
        .prepare(
          `INSERT INTO tasks (id, service, tenant_id, payload, status, completed_at)
           VALUES (?, 'whale', ?, ?, 'completed', datetime('now'))`
        )
        .bind(deliveryId, sub.user_id, JSON.stringify(alert))
        .run();

      chargedUserIds.add(sub.user_id);
      delivered++;
    } else {
      await releaseReservation(db, reserve.reservationId!);
      await db
        .prepare(
          `INSERT INTO whale_deliveries (id, alert_id, user_id, status, error_message)
           VALUES (?, ?, ?, 'failed', 'Webhook delivery failed')`
        )
        .bind(deliveryId, alertId, sub.user_id)
        .run();
      skipped++;
    }
  }

  for (const uid of chargedUserIds) {
    flushCharges(db, uid, env);
  }

  return { delivered, skipped };
}

/**
 * Create subscription. Auth required (userId from auth context).
 */
export async function createSubscription(
  db: D1Database,
  params: Subscription
): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
  const id = crypto.randomUUID();
  const tenantId = params.tenantId ?? "omniclaws";
  try {
    await db
      .prepare(
        `INSERT INTO whale_subscriptions (id, user_id, chain, min_value_usd, webhook_url, email, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.userId,
        params.chain,
        params.minValueUsd ?? 100000,
        params.webhookUrl ?? null,
        params.email ?? null,
        tenantId
      )
      .run();
    return { success: true, subscriptionId: id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Query historical alerts with optional filters.
 */
export async function getWhaleAlerts(
  db: D1Database,
  filters: { chain?: string; minValue?: number; since?: string; limit?: number }
): Promise<WhaleAlert[]> {
  let sql = `SELECT chain, tx_hash, from_address, to_address, value_usd, detected_at FROM whale_alerts WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (filters.chain) {
    sql += ` AND chain = ?`;
    bindings.push(filters.chain);
  }
  if (filters.minValue !== undefined) {
    sql += ` AND value_usd >= ?`;
    bindings.push(filters.minValue);
  }
  if (filters.since) {
    sql += ` AND detected_at >= ?`;
    bindings.push(filters.since);
  }

  sql += ` ORDER BY detected_at DESC LIMIT ?`;
  bindings.push(filters.limit ?? 50);

  const rows = await db.prepare(sql).bind(...bindings).all<{
    chain: string;
    tx_hash: string;
    from_address: string;
    to_address: string;
    value_usd: number;
    detected_at: string;
  }>();

  return (rows.results ?? []).map((r) => ({
    chain: r.chain as "btc" | "eth",
    txHash: r.tx_hash,
    from: r.from_address,
    to: r.to_address ?? "",
    valueUsd: r.value_usd,
    timestamp: new Date(r.detected_at).getTime(),
  }));
}
