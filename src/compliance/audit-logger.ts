/**
 * Immutable audit logging to R2 for compliance (EU AI Act, GDPR)
 * Logs are append-only, keyed by timestamp for chronological retrieval
 */

import type { R2Bucket } from "@cloudflare/workers-types";

export interface AuditEntry {
  timestamp: string;
  event: string;
  service: string;
  tenantId: string;
  payload: Record<string, unknown>;
  decision?: string;
  confidence?: number;
  requiresHumanReview?: boolean;
  region?: string;
}

/**
 * Write immutable audit log to R2
 * Key format: YYYY/MM/DD/HH-mm-ss-{uuid} for chronological ordering
 */
export async function logToR2(
  bucket: R2Bucket,
  entry: AuditEntry
): Promise<void> {
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getUTCHours()).padStart(2, "0")}-${String(now.getUTCMinutes()).padStart(2, "0")}-${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const uuid = crypto.randomUUID().slice(0, 8);
  const key = `audit/${datePath}/${timePart}-${uuid}.json`;

  const body = JSON.stringify(entry, null, 0);
  await bucket.put(key, body, {
    customMetadata: {
      event: entry.event,
      service: entry.service,
      tenantId: entry.tenantId,
    },
  });
}
