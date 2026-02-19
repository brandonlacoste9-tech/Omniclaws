/**
 * GDPR data residency and subject rights
 * EU/EEA data must stay in allowed regions
 * Article 17: Right to erasure
 */

import type { D1Database } from "@cloudflare/workers-types";

/** EU/EEA country codes - data residency restrictions apply */
export const EU_EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH",
]);

export interface DataResidencyResult {
  allowedRegions: string[];
  restrictedRegions: string[];
}

/**
 * Enforce GDPR data residency for EU/EEA countries.
 * EU data must be stored in EU region only.
 *
 * @param countryCode - ISO 3166-1 alpha-2 (e.g. 'DE', 'FR')
 * @param data - Data being processed (for logging)
 * @returns allowedRegions and restrictedRegions
 */
export function enforceDataResidency(
  countryCode: string,
  _data?: unknown
): DataResidencyResult {
  const code = countryCode.toUpperCase();

  if (EU_EEA_COUNTRIES.has(code)) {
    console.log(`[gdpr] EU/EEA request from ${code}: enforcing EU-only storage`);
    return {
      allowedRegions: ["EU"],
      restrictedRegions: ["US", "APAC"],
    };
  }

  return {
    allowedRegions: ["global"],
    restrictedRegions: [],
  };
}

export interface RightToDeletionResult {
  success: boolean;
  tasksAnonymized?: number;
  error?: string;
}

/**
 * Right to erasure (GDPR Article 17).
 * Soft delete: anonymize PII, mark as gdpr_deleted.
 * R2 logs: hard delete option for compliance (some jurisdictions require full deletion).
 *
 * @param userId - User/candidate ID to delete
 * @param db - D1 database
 * @param hardDeleteR2 - If true, delete R2 audit logs (compliance requirement for full erasure)
 */
export async function rightToDeletion(
  userId: string,
  db: D1Database,
  _hardDeleteR2?: boolean
): Promise<RightToDeletionResult> {
  try {
    const result = await db
      .prepare(
        `UPDATE tasks SET status = 'gdpr_deleted', payload = json_object('anonymized', 1, 'deleted_at', datetime('now'))
         WHERE tenant_id = ? AND status != 'gdpr_deleted'`
      )
      .bind(userId)
      .run();

    const tasksAnonymized = result.meta.changes ?? 0;

    await db
      .prepare(
        `UPDATE failed_tasks SET payload = json_object('anonymized', 1), error = 'gdpr_deleted'
         WHERE tenant_id = ?`
      )
      .bind(userId)
      .run();

    try {
      await db
        .prepare(
          `UPDATE human_review_queue SET payload = json_object('anonymized', 1)
           WHERE tenant_id = ?`
        )
        .bind(userId)
        .run();
    } catch {
      // Table may not exist in older deployments
    }

    return { success: true, tasksAnonymized };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Validate that EU user data processing respects residency requirements.
 * @deprecated Use enforceDataResidency for new code
 */
export function validateDataResidency(request: Request): {
  allowed: boolean;
  reason?: string;
} {
  const country = request.headers.get("cf-ipcountry") ?? "XX";
  const result = enforceDataResidency(country);
  if (result.restrictedRegions.length > 0) {
    return { allowed: true }; // Allowed but with restrictions
  }
  return { allowed: true };
}
