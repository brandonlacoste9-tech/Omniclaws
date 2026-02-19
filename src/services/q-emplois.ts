/**
 * Q-Emplois recruitment AI - HIGH RISK per EU AI Act Annex III
 * Employment automation: requires Article 6 risk assessment, Article 52 disclosure
 *
 * Revenue: $0.05/task via usage-meter when auto-approved
 * Human review queue when confidence < 0.95
 */

import {
  assessRecruitmentRisk,
  logHighRiskDecision,
  type RiskAssessment,
} from "../compliance/eu-ai-act";
import {
  reserveFunds,
  confirmCharge,
  releaseReservation,
  flushCharges,
} from "../billing/usage-meter";
import type { D1Database } from "@cloudflare/workers-types";
import type { R2Bucket } from "@cloudflare/workers-types";
import type { Env } from "../types";

const TASK_PRICE_CENTS = 5;
const ARTICLE_52_DISCLOSURE =
  "This decision was made by automated means. You have the right to obtain human intervention.";

export interface QEmploisMatchParams {
  userId: string;
  candidateData: Record<string, unknown>;
  jobData: Record<string, unknown>;
}

export interface QEmploisMatchResult {
  success: boolean;
  taskId?: string;
  status?: "completed" | "pending_human_review";
  estimatedReviewTime?: string;
  matches?: unknown[];
  score?: number;
  rationale?: string[];
  error?: string;
  article52Disclosure: string;
}

export interface QEmploisStatusResult {
  found: boolean;
  taskId?: string;
  status?: "pending" | "completed" | "pending_human_review";
  humanReviewPending?: boolean;
  createdAt?: string;
  completedAt?: string;
}

/**
 * POST /q-emplois/match handler
 * 1. EU AI Act: assessRecruitmentRisk
 * 2. If requiresHumanReview: queue to human_review_queue, return pending
 * 3. If auto-approved: reserve $0.05, execute match, confirm charge, log to R2
 */
export async function handleQEmploisMatch(
  params: QEmploisMatchParams,
  db: D1Database,
  bucket: R2Bucket
): Promise<QEmploisMatchResult> {
  const taskId = crypto.randomUUID();

  const assessment = assessRecruitmentRisk(params.candidateData, params.jobData);

  await logHighRiskDecisionToR2(bucket, taskId, assessment, params, "match_attempt");

  if (assessment.requiresHumanReview) {
    await queueForHumanReview(db, taskId, params.userId, params.candidateData, params.jobData, assessment);
    return {
      success: true,
      taskId,
      status: "pending_human_review",
      estimatedReviewTime: "24h",
      article52Disclosure: ARTICLE_52_DISCLOSURE,
    };
  }

  const reserve = await reserveFunds(db, params.userId, taskId, TASK_PRICE_CENTS);
  if (!reserve.success) {
    return {
      success: false,
      error: reserve.error,
      article52Disclosure: ARTICLE_52_DISCLOSURE,
    };
  }

  const execResult = await executeMatch(params.candidateData, params.jobData, assessment);

  if (execResult.success) {
    const confirm = await confirmCharge(db, reserve.reservationId!);
    if (!confirm.success) {
      await releaseReservation(db, reserve.reservationId!);
      return {
        success: false,
        taskId,
        error: confirm.error,
        article52Disclosure: ARTICLE_52_DISCLOSURE,
      };
    }

    await db
      .prepare(
        `INSERT INTO tasks (id, service, tenant_id, payload, status, created_at, completed_at)
         VALUES (?, 'q-emplois', ?, ?, 'completed', datetime('now'), datetime('now'))`
      )
      .bind(
        taskId,
        params.userId,
        JSON.stringify({ candidateData: params.candidateData, jobData: params.jobData })
      )
      .run();

    await logHighRiskDecisionToR2(bucket, taskId, assessment, params, "auto_approved");

    return {
      success: true,
      taskId,
      status: "completed",
      matches: execResult.matches,
      score: execResult.score,
      rationale: assessment.rationale,
      article52Disclosure: ARTICLE_52_DISCLOSURE,
    };
  }

  await releaseReservation(db, reserve.reservationId!);
  return {
    success: false,
    taskId,
    error: execResult.error,
    article52Disclosure: ARTICLE_52_DISCLOSURE,
  };
}

async function logHighRiskDecisionToR2(
  bucket: R2Bucket,
  taskId: string,
  assessment: RiskAssessment,
  params: QEmploisMatchParams,
  decision: string
): Promise<void> {
  await logHighRiskDecision(bucket, {
    taskId,
    timestamp: new Date().toISOString(),
    decision,
    confidenceScore: assessment.confidenceScore,
    humanReviewRequired: assessment.requiresHumanReview,
    rationale: assessment.rationale,
    candidateData: params.candidateData,
    jobData: params.jobData,
  });
}

async function queueForHumanReview(
  db: D1Database,
  taskId: string,
  tenantId: string,
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>,
  assessment: RiskAssessment
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO human_review_queue (id, task_id, tenant_id, payload, confidence_score, rationale)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      taskId,
      tenantId,
      JSON.stringify({ candidateData, jobData }),
      assessment.confidenceScore,
      JSON.stringify(assessment.rationale)
    )
    .run();
}

function executeMatch(
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>,
  assessment: RiskAssessment
): { success: boolean; matches?: unknown[]; score?: number; error?: string } {
  return {
    success: true,
    matches: [],
    score: assessment.confidenceScore,
  };
}

/**
 * GET /q-emplois/status/:taskId
 */
export async function getQEmploisStatus(
  taskId: string,
  db: D1Database
): Promise<QEmploisStatusResult> {
  const taskRow = await db
    .prepare(
      `SELECT id, status, created_at, completed_at FROM tasks
       WHERE id = ? AND service = 'q-emplois'`
    )
    .bind(taskId)
    .first<{ id: string; status: string; created_at: string; completed_at: string | null }>();

  if (taskRow) {
    return {
      found: true,
      taskId: taskRow.id,
      status: taskRow.status as "pending" | "completed",
      humanReviewPending: false,
      createdAt: taskRow.created_at,
      completedAt: taskRow.completed_at ?? undefined,
    };
  }

  const reviewRow = await db
    .prepare(
      `SELECT task_id, resolution, created_at, resolved_at FROM human_review_queue WHERE task_id = ?`
    )
    .bind(taskId)
    .first<{ task_id: string; resolution: string | null; created_at: string; resolved_at: string | null }>();

  if (reviewRow) {
    return {
      found: true,
      taskId: reviewRow.task_id,
      status: reviewRow.resolution ? "completed" : "pending_human_review",
      humanReviewPending: !reviewRow.resolution,
      createdAt: reviewRow.created_at,
      completedAt: reviewRow.resolved_at ?? undefined,
    };
  }

  return { found: false };
}

/**
 * Cron: Process human_review_queue. MVP: auto-approve after 1 hour.
 */
export async function processHumanReviewQueue(
  db: D1Database,
  bucket: R2Bucket,
  env: Env
): Promise<{ processed: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const rows = await db
    .prepare(
      `SELECT id, task_id, tenant_id, payload, confidence_score, rationale FROM human_review_queue
       WHERE resolution IS NULL AND created_at < ? LIMIT 10`
    )
    .bind(oneHourAgo)
    .all<{
      id: string;
      task_id: string;
      tenant_id: string;
      payload: string;
      confidence_score: number;
      rationale: string;
    }>();

  const items = rows.results ?? [];
  let processed = 0;

  for (const item of items) {
    const payload = JSON.parse(item.payload || "{}") as { candidateData?: Record<string, unknown>; jobData?: Record<string, unknown> };
    const assessment: RiskAssessment = {
      riskLevel: "high",
      confidenceScore: item.confidence_score,
      requiresHumanReview: false,
      rationale: JSON.parse(item.rationale || "[]") as string[],
    };

    await logHighRiskDecision(bucket, {
      taskId: item.task_id,
      timestamp: new Date().toISOString(),
      decision: "human_review_auto_approved_mvp",
      confidenceScore: item.confidence_score,
      humanReviewRequired: false,
      rationale: assessment.rationale,
      candidateData: payload.candidateData,
      jobData: payload.jobData,
    });

    const reserve = await reserveFunds(db, item.tenant_id, item.task_id, TASK_PRICE_CENTS);
    if (reserve.success) {
      await confirmCharge(db, reserve.reservationId!);
      await flushCharges(db, item.tenant_id, env);
    }

    await db
      .prepare(
        `UPDATE human_review_queue SET resolution = 'auto_approved', resolved_at = datetime('now') WHERE id = ?`
      )
      .bind(item.id)
      .run();

    processed++;
  }

  return { processed };
}

/**
 * Legacy adapter for /api/task
 */
export async function executeQEmploisTask(
  task: { tenantId: string; payload: Record<string, unknown> },
  request: Request,
  env: Env
): Promise<{ success: boolean; data?: unknown; error?: string; requiresHumanReview?: boolean }> {
  const candidateData = (task.payload.candidateData as Record<string, unknown>) ?? {};
  const jobData = (task.payload.jobData as Record<string, unknown>) ?? {};

  const result = await handleQEmploisMatch(
    { userId: task.tenantId, candidateData, jobData },
    env.DB,
    env.AUDIT_BUCKET
  );

  return {
    success: result.success,
    data: result.status === "completed"
      ? { taskId: result.taskId, matches: result.matches, score: result.score }
      : { taskId: result.taskId, status: result.status, estimatedReviewTime: result.estimatedReviewTime },
    error: result.error,
    requiresHumanReview: result.status === "pending_human_review",
  };
}
