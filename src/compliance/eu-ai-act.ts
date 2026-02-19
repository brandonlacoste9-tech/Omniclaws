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
