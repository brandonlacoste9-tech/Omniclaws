// Immutable audit logger to R2 storage for EU AI Act conformity assessments
import type { Env, AuditLogEntry } from '../types';

/**
 * Audit logger that writes immutable logs to R2 bucket
 * Required for EU AI Act Article 6 compliance
 */
export class AuditLogger {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  /**
   * Log an audit event to R2 (append-only)
   */
  async log(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    const logEntry: AuditLogEntry = {
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
    } catch (error) {
      // Log to console as fallback (should trigger alerts in production)
      console.error('Failed to write audit log to R2:', error);
      throw error;
    }
  }

  /**
   * Log AI decision for high-risk system compliance
   */
  async logAIDecision(
    userId: string,
    taskId: string,
    service: string,
    confidence: number,
    decision: unknown,
    requiresHumanReview: boolean
  ): Promise<void> {
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
  async logHumanReview(
    userId: string,
    taskId: string,
    service: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    reasoning: string
  ): Promise<void> {
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
  async logDataAccess(
    userId: string,
    service: string,
    dataType: string,
    purpose: string
  ): Promise<void> {
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
  async logTransaction(
    userId: string,
    transactionId: string,
    provider: string,
    amount: number,
    currency: string
  ): Promise<void> {
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
  async queryLogs(startDate: string, endDate: string): Promise<R2Objects | null> {
    return await this.bucket.list({
      prefix: `audit-logs/`,
      startAfter: `audit-logs/${startDate}`,
      limit: 1000
    });
  }
}
