/**
 * EU AI Act Compliance Layer (Article 6 - High-Risk AI Systems)
 * Implements risk assessment, human-in-the-loop, and decision logging for high-risk AI
 */

export interface RiskAssessment {
  id: string;
  taskId: string;
  service: string;
  riskLevel: 'high' | 'medium' | 'low';
  confidence: number;
  requiresHumanReview: boolean;
  decisionRationale: string;
  timestamp: number;
}

export interface HighRiskCheck {
  passed: boolean;
  assessment: RiskAssessment;
  requiresHumanReview: boolean;
}

// Services categorized as high-risk under EU AI Act Article 6
const HIGH_RISK_SERVICES = new Set(['q-emplois']); // Recruitment automation

/**
 * Determines if a service is high-risk under EU AI Act
 */
export function isHighRiskService(service: string): boolean {
  return HIGH_RISK_SERVICES.has(service);
}

/**
 * Performs risk assessment for AI tasks
 * Article 6: High-risk AI systems in employment (recruitment, selection, promotion)
 */
export async function performRiskAssessment(
  taskId: string,
  service: string,
  _input: any,
  confidence: number
): Promise<RiskAssessment> {
  const riskLevel = isHighRiskService(service) ? 'high' : 'low';
  
  // EU AI Act Article 6: Confidence threshold of 0.95 for high-risk AI
  const requiresHumanReview = riskLevel === 'high' && confidence < 0.95;
  
  // Generate decision rationale
  let decisionRationale = '';
  if (riskLevel === 'high') {
    decisionRationale = `High-risk AI system (${service}) under EU AI Act Article 6. `;
    if (requiresHumanReview) {
      decisionRationale += `Confidence ${confidence.toFixed(3)} below threshold 0.95, requires human review. `;
    } else {
      decisionRationale += `Confidence ${confidence.toFixed(3)} meets threshold 0.95, approved for automated processing. `;
    }
    
    // Log specific concerns for recruitment AI
    if (service === 'q-emplois') {
      decisionRationale += 'Employment screening system subject to transparency and human oversight requirements per Article 13-14.';
    }
  } else {
    decisionRationale = `Low-risk AI system (${service}), standard processing approved.`;
  }
  
  return {
    id: crypto.randomUUID(),
    taskId,
    service,
    riskLevel,
    confidence,
    requiresHumanReview,
    decisionRationale,
    timestamp: Date.now(),
  };
}

/**
 * Checks if a task can proceed based on EU AI Act requirements
 */
export async function checkHighRiskCompliance(
  taskId: string,
  service: string,
  input: any,
  confidence: number = 1.0,
  db: D1Database
): Promise<HighRiskCheck> {
  // Perform risk assessment
  const assessment = await performRiskAssessment(taskId, service, input, confidence);
  
  // Store assessment in database for audit trail
  await db
    .prepare(
      `INSERT INTO ai_risk_assessments 
       (id, task_id, service, risk_level, confidence, requires_human_review, decision_rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      assessment.id,
      assessment.taskId,
      assessment.service,
      assessment.riskLevel,
      assessment.confidence,
      assessment.requiresHumanReview ? 1 : 0,
      assessment.decisionRationale,
      Math.floor(assessment.timestamp / 1000)
    )
    .run();
  
  // High-risk tasks requiring human review should not proceed automatically
  const passed = !(assessment.riskLevel === 'high' && assessment.requiresHumanReview);
  
  return {
    passed,
    assessment,
    requiresHumanReview: assessment.requiresHumanReview,
  };
}

/**
 * Records human review decision for high-risk AI tasks
 */
export async function recordHumanReview(
  assessmentId: string,
  approved: boolean,
  reviewerNotes: string,
  db: D1Database
): Promise<void> {
  const reviewedAt = Math.floor(Date.now() / 1000);
  
  await db
    .prepare(
      `UPDATE ai_risk_assessments 
       SET human_reviewed_at = ?,
           decision_rationale = decision_rationale || ' | Human review: ' || ? || ' Notes: ' || ?
       WHERE id = ?`
    )
    .bind(reviewedAt, approved ? 'APPROVED' : 'REJECTED', reviewerNotes, assessmentId)
    .run();
}

/**
 * Retrieves pending human reviews for high-risk AI tasks
 */
export async function getPendingHumanReviews(db: D1Database): Promise<RiskAssessment[]> {
  const results = await db
    .prepare(
      `SELECT * FROM ai_risk_assessments 
       WHERE requires_human_review = 1 AND human_reviewed_at IS NULL
       ORDER BY created_at ASC`
    )
    .all();
  
  return (results.results || []).map((row: any) => ({
    id: row.id,
    taskId: row.task_id,
    service: row.service,
    riskLevel: row.risk_level,
    confidence: row.confidence,
    requiresHumanReview: row.requires_human_review === 1,
    decisionRationale: row.decision_rationale,
    timestamp: row.created_at * 1000,
  }));
}
