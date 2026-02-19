/**
 * Omniclaws - Environment bindings and shared types
 */

import type { Tenant } from "./middleware/tenant";

export interface Env {
  DB: D1Database;
  AUDIT_BUCKET: R2Bucket;
  TENANT?: Tenant;
  PADDLE_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PADDLE_SANDBOX?: string;
  OPENCLAW_API_KEY?: string;
  ZYEUTE_API_KEY?: string;
  ADMIN_API_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  ENVIRONMENT?: string;
  ALCHEMY_API_KEY?: string;
  POSTHOG_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_DOMAIN?: string;
  BLOCKCHAIR_API_KEY?: string;
  WHALE_API_KEY?: string;
  TASK_PRICE_CENTS: string;
  TASK_PRICE_TIER_BASIC?: string;
  TASK_PRICE_TIER_STANDARD?: string;
  TASK_PRICE_TIER_COMPLEX?: string;
  MAX_RETRIES: string;
  CONFIDENCE_THRESHOLD: string;
}

export interface TaskRequest {
  service: "openclaw" | "q-emplois" | "zyeute-content";
  tenantId: string;
  payload: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  taskId?: string;
  data?: unknown;
  error?: string;
  requiresHumanReview?: boolean;
}

export type BillingRegion = "EU" | "US" | "CA" | "OTHER";
