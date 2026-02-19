/**
 * EU AI Act Compliance (Article 6 - High-Risk AI Systems)
 * Implements risk assessment, human oversight, and decision logging for recruitment AI
 */

import { logAIDecision } from './audit-logger';
import { isEUAIActCountry } from '../utils/geo-router';

export type RiskLevel = 'low' | 'medium' | 'high';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AIRiskAssessment {
  taskId: string;
  serviceType: string;
  riskLevel: RiskLevel;
  confidenceScore: number;
  requiresHumanReview: boolean;
  decisionRationale: string;
  assessedAt: number;
}

export interface AIActEnv {
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

// Confidence threshold below which human review is required (EU AI Act Article 14)
const HUMAN_REVIEW_THRESHOLD = 0.95;

/**
 * Determines if a service is classified as high-risk under EU AI Act
 * Article 6: AI systems used in employment, workers management and access to self-employment
 */
export function isHighRiskAI(serviceType: string): boolean {
  const highRiskServices = [
    'q-emplois',  // Recruitment automation
    // Add other high-risk AI categories here
  ];
  
  return highRiskServices.includes(serviceType);
}

/**
 * Performs risk assessment for AI task
 * Article 9: Risk management system
 */
export async function assessAIRisk(
  env: AIActEnv,
  taskId: string,
  userId: string,
  serviceType: string,
  taskPayload: Record<string, unknown>,
  countryCode: string,
  request?: Request
): Promise<AIRiskAssessment> {
  // Determine base risk level
  const riskLevel = determineRiskLevel(serviceType, taskPayload);
  
  // Calculate confidence score (in production, use actual ML model)
  const confidenceScore = calculateConfidenceScore(taskPayload);
  
  // Determine if human review is required
  const requiresHumanReview = shouldRequireHumanReview(
    riskLevel,
    confidenceScore,
    countryCode,
    serviceType
  );
  
  // Generate decision rationale
  const decisionRationale = generateRationale(
    riskLevel,
    confidenceScore,
    requiresHumanReview,
    taskPayload
  );
  
  const assessment: AIRiskAssessment = {
    taskId,
    serviceType,
    riskLevel,
    confidenceScore,
    requiresHumanReview,
    decisionRationale,
    assessedAt: Date.now(),
  };
  
  // Store in database (Article 12: Record-keeping)
  await env.DB.prepare(`
    INSERT INTO ai_risk_assessments (
      id, task_id, service_type, risk_level, confidence_score,
      requires_human_review, human_review_status, decision_rationale, assessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    taskId,
    serviceType,
    riskLevel,
    confidenceScore,
    requiresHumanReview ? 1 : 0,
    requiresHumanReview ? 'pending' : null,
    decisionRationale,
    assessment.assessedAt
  ).run();
  
  // Log to immutable audit trail (Article 12: Logging capabilities)
  await logAIDecision(
    env,
    taskId,
    userId,
    serviceType,
    {
      riskLevel,
      confidence: confidenceScore,
      rationale: decisionRationale,
      requiresHumanReview,
    },
    request
  );
  
  return assessment;
}

/**
 * Determines risk level based on service type and payload
 */
function determineRiskLevel(serviceType: string, _payload: Record<string, unknown>): RiskLevel {
  if (isHighRiskAI(serviceType)) {
    return 'high';
  }
  
  // Check for sensitive data in payload
  const sensitiveFields = ['personalData', 'biometricData', 'healthData'];
  const hasSensitiveData = sensitiveFields.some(field => field in _payload);
  
  if (hasSensitiveData) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Calculates AI confidence score
 * In production, this would use the actual AI model's confidence output
 */
function calculateConfidenceScore(payload: Record<string, unknown>): number {
  // Placeholder: In real implementation, get from ML model
  // For now, use payload completeness as proxy
  const requiredFields = ['input', 'parameters'];
  const presentFields = requiredFields.filter(field => field in payload && payload[field]);
  
  const baseScore = presentFields.length / requiredFields.length;
  
  // Add some randomness to simulate real confidence scores
  return Math.min(0.99, baseScore + (Math.random() * 0.1));
}

/**
 * Determines if human review is required
 * Article 14: Human oversight
 */
function shouldRequireHumanReview(
  riskLevel: RiskLevel,
  confidenceScore: number,
  countryCode: string,
  serviceType: string
): boolean {
  // EU AI Act only applies to EU countries
  if (!isEUAIActCountry(countryCode)) {
    return false;
  }
  
  // High-risk AI always requires human review if confidence is low
  if (isHighRiskAI(serviceType) && confidenceScore < HUMAN_REVIEW_THRESHOLD) {
    return true;
  }
  
  // High risk level requires review
  if (riskLevel === 'high' && confidenceScore < HUMAN_REVIEW_THRESHOLD) {
    return true;
  }
  
  return false;
}

/**
 * Generates human-readable rationale for the decision
 * Article 13: Transparency and provision of information to users
 */
function generateRationale(
  riskLevel: RiskLevel,
  confidenceScore: number,
  requiresHumanReview: boolean,
  _payload: Record<string, unknown>
): string {
  const parts: string[] = [];
  
  parts.push(`Risk Level: ${riskLevel}`);
  parts.push(`AI Confidence: ${(confidenceScore * 100).toFixed(1)}%`);
  
  if (requiresHumanReview) {
    parts.push(`Human review required due to confidence below ${HUMAN_REVIEW_THRESHOLD * 100}% threshold (EU AI Act Article 14)`);
  }
  
  if (riskLevel === 'high') {
    parts.push('Classified as high-risk AI system under EU AI Act Article 6');
  }
  
  return parts.join('. ');
}

/**
 * Validates that AI task can proceed
 * Returns true if task can execute, false if blocked pending review
 */
export async function canExecuteAITask(
  env: AIActEnv,
  taskId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const assessment = await env.DB.prepare(`
    SELECT requires_human_review, human_review_status
    FROM ai_risk_assessments
    WHERE task_id = ?
  `).bind(taskId).first();
  
  if (!assessment) {
    return { allowed: false, reason: 'No risk assessment found' };
  }
  
  if (!assessment.requires_human_review) {
    return { allowed: true };
  }
  
  if (assessment.human_review_status === 'approved') {
    return { allowed: true };
  }
  
  if (assessment.human_review_status === 'rejected') {
    return { allowed: false, reason: 'Task rejected by human reviewer' };
  }
  
  return { allowed: false, reason: 'Pending human review' };
}

/**
 * Records human review decision
 * Article 14: Human oversight - meaningful human oversight
 */
export async function recordHumanReview(
  env: AIActEnv,
  taskId: string,
  reviewerId: string,
  approved: boolean,
  notes: string
): Promise<void> {
  const status: ReviewStatus = approved ? 'approved' : 'rejected';
  
  await env.DB.prepare(`
    UPDATE ai_risk_assessments
    SET human_review_status = ?, reviewed_at = ?
    WHERE task_id = ?
  `).bind(status, Date.now(), taskId).run();
  
  // Log review decision to audit trail
  await logAIDecision(
    env,
    taskId,
    reviewerId,
    'human-review',
    {
      riskLevel: 'high',
      confidence: 1.0,
      rationale: `Human review by ${reviewerId}: ${approved ? 'Approved' : 'Rejected'}. Notes: ${notes}`,
      requiresHumanReview: false,
    }
  );
}
/**
 * EU AI Act Article 6 compliance - High-risk AI systems (recruitment automation)
 *
 * **Article 6**: High-risk AI systems listed in Annex III require risk management,
 * human oversight, and transparency. Recruitment AI that automates employment
 * decisions (screening, ranking, rejection) is explicitly high-risk.
 *
 * **Article 52**: Right to explanation - data subjects must be informed that
 * a decision was made by automated means and have the right to obtain human
 * intervention, express their point of view, and contest the decision.
 *
 * **Annex III(5)**: AI intended to be used for recruitment or selection of natural
 * persons, notably for advertising vacancies, screening or filtering applications.
 *
 * @see https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
 */

import type { R2Bucket } from "@cloudflare/workers-types";

const CONFIDENCE_THRESHOLD = 0.95;

/**
 * Risk assessment result per EU AI Act Article 6.
 * High-risk AI: recruitment automation affects employment decisions (Annex III).
 */
export interface RiskAssessment {
  riskLevel: "minimal" | "high";
  confidenceScore: number;
  requiresHumanReview: boolean;
  rationale: string[];
}

export interface HighRiskAuditData {
  taskId: string;
  timestamp: string;
  decision: string;
  confidenceScore: number;
  humanReviewRequired: boolean;
  rationale: string[];
  candidateData?: Record<string, unknown>;
  jobData?: Record<string, unknown>;
}

/**
 * Assess recruitment risk per EU AI Act Article 6 Annex III.
 * Automated decisions affecting employment require human oversight when confidence < 0.95.
 *
 * @param candidateData - Candidate profile (skills, experience, etc.)
 * @param jobData - Job description and requirements
 * @returns RiskAssessment with riskLevel, confidenceScore, requiresHumanReview, rationale
 */
export function assessRecruitmentRisk(
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>
): RiskAssessment {
  const rationale: string[] = [];
  const confidenceScore = calculateSkillsMatchScore(candidateData, jobData, rationale);

  const requiresHumanReview = confidenceScore < CONFIDENCE_THRESHOLD;
  const riskLevel = requiresHumanReview ? "high" : "minimal";

  if (requiresHumanReview) {
    rationale.push("Automated rejection proposed");
    rationale.push("Confidence below 0.95 threshold - human intervention required per Article 6");
  }

  if (confidenceScore < 0.7) {
    rationale.push("Skill mismatch detected");
  }

  return {
    riskLevel,
    confidenceScore,
    requiresHumanReview,
    rationale,
  };
}

/**
 * Mock AI scoring: skills match percentage (0.0-1.0).
 * In production: replace with actual ML model.
 */
function calculateSkillsMatchScore(
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>,
  rationale: string[]
): number {
  const candidateSkills = (candidateData.skills as string[]) ?? [];
  const jobRequirements = (jobData.requiredSkills as string[]) ?? [];
  const jobNiceToHave = (jobData.preferredSkills as string[]) ?? [];

  if (jobRequirements.length === 0) {
    rationale.push("No job requirements specified - defaulting to moderate confidence");
    return 0.85;
  }

  const requiredMatch = jobRequirements.filter((r) =>
    candidateSkills.some((s) => String(s).toLowerCase().includes(String(r).toLowerCase()))
  ).length;
  const preferredMatch = jobNiceToHave.filter((r) =>
    candidateSkills.some((s) => String(s).toLowerCase().includes(String(r).toLowerCase()))
  ).length;

  const requiredScore = jobRequirements.length > 0 ? requiredMatch / jobRequirements.length : 1;
  const preferredScore = jobNiceToHave.length > 0 ? preferredMatch / jobNiceToHave.length : 0.5;

  const score = requiredScore * 0.8 + preferredScore * 0.2;
  const confidence = Math.min(0.99, Math.max(0.1, score + (Math.random() * 0.05 - 0.02)));

  rationale.push(
    `Skills match: ${Math.round(requiredScore * 100)}% required, ${Math.round(preferredScore * 100)}% preferred`
  );

  return confidence;
}

/**
 * Log high-risk decision to R2. Immutable write-once audit trail.
 * Path: audit/eu-ai-act/YYYY/MM/DD/{timestamp}_{taskId}.json
 *
 * Article 52: Data subjects have the right to obtain an explanation of the decision.
 * Must not fail silently - throws on R2 write failure.
 */
export async function logHighRiskDecision(
  bucket: R2Bucket,
  auditData: HighRiskAuditData
): Promise<void> {
  const now = new Date(auditData.timestamp);
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
  const timestamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const key = `audit/eu-ai-act/${datePath}/${timestamp}_${auditData.taskId}.json`;

  const payload = {
    ...auditData,
    dataSubjectRights: "Right to explanation per Article 52",
  };

  try {
    await bucket.put(key, JSON.stringify(payload, null, 0), {
      customMetadata: {
        taskId: auditData.taskId,
        humanReviewRequired: String(auditData.humanReviewRequired),
      },
    });
  } catch (err) {
    console.error("[eu-ai-act] R2 write failed - compliance violation:", err);
    throw new Error(`EU AI Act audit log failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
