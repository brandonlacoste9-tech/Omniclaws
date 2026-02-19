/**
 * Audit logger that writes immutable logs to R2 bucket
 * Required for EU AI Act Article 6 compliance
 */
export class AuditLogger {
    constructor(bucket) {
        this.bucket = bucket;
    }
    /**
     * Log an audit event to R2 (append-only)
     */
    async log(entry) {
        const logEntry = {
            timestamp: Date.now(),
            ...entry
        };
        // Generate unique key with timestamp and random ID for immutability
        const key = `audit-logs/${new Date().toISOString().split('T')[0]}/${logEntry.timestamp}-${crypto.randomUUID()}.json`;
        try {
            await this.bucket.put(key, JSON.stringify(logEntry, null, 2), {
                httpMetadata: {
                    contentType: 'application/json'
                },
                customMetadata: {
                    event_type: entry.event_type,
                    service: entry.service,
                    user_id: entry.user_id,
                    compliance: entry.compliance_flags.join(',')
                }
            });
        }
        catch (error) {
            // Log to console as fallback (should trigger alerts in production)
            console.error('Failed to write audit log to R2:', error);
            throw error;
        }
    }
    /**
     * Log AI decision for high-risk system compliance
     */
    async logAIDecision(userId, taskId, service, confidence, decision, requiresHumanReview) {
        await this.log({
            event_type: 'ai_decision',
            service,
            user_id: userId,
            task_id: taskId,
            details: {
                confidence,
                decision,
                requires_human_review: requiresHumanReview
            },
            compliance_flags: ['EU_AI_ACT_ARTICLE_6', 'HIGH_RISK_AI']
        });
    }
    /**
     * Log human oversight action
     */
    async logHumanReview(userId, taskId, service, reviewerId, decision, reasoning) {
        await this.log({
            event_type: 'human_review',
            service,
            user_id: userId,
            task_id: taskId,
            details: {
                reviewer_id: reviewerId,
                decision,
                reasoning
            },
            compliance_flags: ['EU_AI_ACT_ARTICLE_6', 'HUMAN_OVERSIGHT']
        });
    }
    /**
     * Log GDPR data access
     */
    async logDataAccess(userId, service, dataType, purpose) {
        await this.log({
            event_type: 'data_access',
            service,
            user_id: userId,
            details: {
                data_type: dataType,
                purpose
            },
            compliance_flags: ['GDPR_ARTICLE_30']
        });
    }
    /**
     * Log payment transaction for audit trail
     */
    async logTransaction(userId, transactionId, provider, amount, currency) {
        await this.log({
            event_type: 'payment_transaction',
            service: 'billing',
            user_id: userId,
            details: {
                transaction_id: transactionId,
                provider,
                amount,
                currency
            },
            compliance_flags: ['PCI_DSS', 'FINANCIAL_AUDIT']
        });
    }
    /**
     * Query audit logs by date range (for compliance reports)
     */
    async queryLogs(startDate) {
        return await this.bucket.list({
            prefix: `audit-logs/`,
            startAfter: `audit-logs/${startDate}`,
            limit: 1000
        });
    }
}
