// EU AI Act Article 6 compliance monitor for high-risk AI systems
import type { Env, AIDecision, HumanOversightItem } from '../types';
import { AuditLogger } from './audit-logger';

/**
 * EU AI Act compliance checker for high-risk AI systems
 * Implements Article 6 requirements:
 * - Human oversight for low-confidence decisions
 * - Audit trail for all decisions
 * - CE marking compliance hooks
 */
export class EUAIActMonitor {
  private db: D1Database;
  private auditLogger: AuditLogger;
  private readonly confidenceThreshold = 0.95;

  constructor(env: Env) {
    this.db = env.DB;
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);
  }

  /**
   * Evaluate if an AI decision requires human oversight
   * Per EU AI Act Article 6: High-risk systems must have human oversight
   */
  async evaluateDecision(
    userId: string,
    taskId: string,
    service: string,
    decision: AIDecision
  ): Promise<{ approved: boolean; requiresReview: boolean; oversightId?: string }> {
    // Log the AI decision for audit trail
    await this.auditLogger.logAIDecision(
      userId,
      taskId,
      service,
      decision.confidence,
      decision.recommendation,
      decision.requiresHumanReview || decision.confidence < this.confidenceThreshold
    );

    // Check if human review is required
    const requiresReview = 
      decision.requiresHumanReview || 
      decision.confidence < this.confidenceThreshold ||
      this.isHighRiskService(service);

    if (requiresReview) {
      // Queue for human oversight
      const oversightId = crypto.randomUUID();
      await this.queueForHumanReview(
        oversightId,
        taskId,
        service,
        decision.confidence,
        decision.recommendation
      );

      return {
        approved: false,
        requiresReview: true,
        oversightId
      };
    }

    // Auto-approve high-confidence decisions
    return {
      approved: true,
      requiresReview: false
    };
  }

  /**
   * Queue a decision for human review
   */
  private async queueForHumanReview(
    id: string,
    taskId: string,
    service: string,
    confidence: number,
    recommendation: unknown
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO human_oversight_queue 
        (id, task_id, service, decision_type, confidence, ai_recommendation, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        taskId,
        service,
        'ai_decision',
        confidence,
        JSON.stringify(recommendation),
        'pending',
        Date.now()
      )
      .run();
  }

  /**
   * Process human review decision
   */
  async processHumanReview(
    oversightId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    reasoning: string
  ): Promise<void> {
    // Get oversight item
    const result = await this.db
      .prepare('SELECT * FROM human_oversight_queue WHERE id = ?')
      .bind(oversightId)
      .first<HumanOversightItem>();

    if (!result) {
      throw new Error('Oversight item not found');
    }

    // Update oversight queue
    await this.db
      .prepare(
        `UPDATE human_oversight_queue 
        SET status = ?, human_decision = ?, reviewed_at = ?, reviewer_id = ?
        WHERE id = ?`
      )
      .bind(
        decision,
        JSON.stringify({ decision, reasoning }),
        Date.now(),
        reviewerId,
        oversightId
      )
      .run();

    // Log human review action
    await this.auditLogger.logHumanReview(
      result.task_id,
      result.task_id,
      result.service,
      reviewerId,
      decision,
      reasoning
    );

    // Update task status based on decision
    const taskStatus = decision === 'approved' ? 'completed' : 'failed';
    await this.db
      .prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
      .bind(taskStatus, Date.now(), result.task_id)
      .run();
  }

  /**
   * Get pending oversight items
   */
  async getPendingOversight(limit = 50): Promise<HumanOversightItem[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM human_oversight_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?'
      )
      .bind('pending', limit)
      .all();

    return result.results as unknown as HumanOversightItem[];
  }

  /**
   * Check if service is classified as high-risk under EU AI Act
   */
  private isHighRiskService(service: string): boolean {
    // Q-Emplois is classified as high-risk (recruitment/employment)
    // Per EU AI Act Annex III: employment, workers management and access to self-employment
    return service === 'q-emplois';
  }

  /**
   * Generate compliance report for CE marking
   * Required documentation for conformity assessment
   */
  async generateComplianceReport(startDate: Date, endDate: Date): Promise<{
    totalDecisions: number;
    humanReviewedDecisions: number;
    averageConfidence: number;
    complianceRate: number;
  }> {
    const startTs = startDate.getTime();
    const endTs = endDate.getTime();

    // Query oversight queue for statistics
    const result = await this.db
      .prepare(
        `SELECT 
          COUNT(*) as total,
          AVG(confidence) as avg_confidence,
          SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) as reviewed
        FROM human_oversight_queue
        WHERE created_at >= ? AND created_at <= ?`
      )
      .bind(startTs, endTs)
      .first<{ total: number; avg_confidence: number; reviewed: number }>();

    if (!result) {
      return {
        totalDecisions: 0,
        humanReviewedDecisions: 0,
        averageConfidence: 0,
        complianceRate: 0
      };
    }

    return {
      totalDecisions: result.total,
      humanReviewedDecisions: result.reviewed,
      averageConfidence: result.avg_confidence,
      complianceRate: result.total > 0 ? (result.reviewed / result.total) * 100 : 0
    };
  }
}
