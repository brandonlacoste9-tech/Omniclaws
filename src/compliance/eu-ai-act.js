import { AuditLogger } from './audit-logger';
/**
 * EU AI Act compliance checker for high-risk AI systems
 * Implements Article 6 requirements:
 * - Human oversight for low-confidence decisions
 * - Audit trail for all decisions
 * - CE marking compliance hooks
 */
export class EUAIActMonitor {
    constructor(env) {
        this.confidenceThreshold = 0.95;
        this.db = env.DB;
        this.auditLogger = new AuditLogger(env.AUDIT_LOGS);
    }
    /**
     * Evaluate if an AI decision requires human oversight
     * Per EU AI Act Article 6: High-risk systems must have human oversight
     */
    async evaluateDecision(userId, taskId, service, decision) {
        // Log the AI decision for audit trail
        await this.auditLogger.logAIDecision(userId, taskId, service, decision.confidence, decision.recommendation, decision.requiresHumanReview || decision.confidence < this.confidenceThreshold);
        // Check if human review is required
        const requiresReview = decision.requiresHumanReview ||
            decision.confidence < this.confidenceThreshold ||
            this.isHighRiskService(service);
        if (requiresReview) {
            // Queue for human oversight
            const oversightId = crypto.randomUUID();
            await this.queueForHumanReview(oversightId, taskId, service, decision.confidence, decision.recommendation);
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
    async queueForHumanReview(id, taskId, service, confidence, recommendation) {
        await this.db
            .prepare(`INSERT INTO human_oversight_queue 
        (id, task_id, service, decision_type, confidence, ai_recommendation, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id, taskId, service, 'ai_decision', confidence, JSON.stringify(recommendation), 'pending', Date.now())
            .run();
    }
    /**
     * Process human review decision
     */
    async processHumanReview(oversightId, reviewerId, decision, reasoning) {
        // Get oversight item
        const result = await this.db
            .prepare('SELECT * FROM human_oversight_queue WHERE id = ?')
            .bind(oversightId)
            .first();
        if (!result) {
            throw new Error('Oversight item not found');
        }
        // Update oversight queue
        await this.db
            .prepare(`UPDATE human_oversight_queue 
        SET status = ?, human_decision = ?, reviewed_at = ?, reviewer_id = ?
        WHERE id = ?`)
            .bind(decision, JSON.stringify({ decision, reasoning }), Date.now(), reviewerId, oversightId)
            .run();
        // Log human review action
        await this.auditLogger.logHumanReview(result.task_id, result.task_id, result.service, reviewerId, decision, reasoning);
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
    async getPendingOversight(limit = 50) {
        const result = await this.db
            .prepare('SELECT * FROM human_oversight_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?')
            .bind('pending', limit)
            .all();
        return result.results;
    }
    /**
     * Check if service is classified as high-risk under EU AI Act
     */
    isHighRiskService(service) {
        // Q-Emplois is classified as high-risk (recruitment/employment)
        // Per EU AI Act Annex III: employment, workers management and access to self-employment
        return service === 'q-emplois';
    }
    /**
     * Generate compliance report for CE marking
     * Required documentation for conformity assessment
     */
    async generateComplianceReport(startDate, endDate) {
        const startTs = startDate.getTime();
        const endTs = endDate.getTime();
        // Query oversight queue for statistics
        const result = await this.db
            .prepare(`SELECT 
          COUNT(*) as total,
          AVG(confidence) as avg_confidence,
          SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) as reviewed
        FROM human_oversight_queue
        WHERE created_at >= ? AND created_at <= ?`)
            .bind(startTs, endTs)
            .first();
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
