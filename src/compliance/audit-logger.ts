/**
 * Audit Logger: Immutable logging to R2 for compliance
 * All high-risk AI decisions and critical operations are logged
 */

export interface AuditLog {
  id: string;
  timestamp: number;
  type: 'task_execution' | 'ai_decision' | 'billing' | 'compliance_check' | 'error' | 'human_review';
  userId: string;
  taskId?: string;
  service?: string;
  action: string;
  details: Record<string, any>;
  metadata: {
    userAgent?: string;
    ip?: string;
    country?: string;
    requestId?: string;
  };
}

/**
 * Formats log entry as immutable JSON
 */
function formatLogEntry(log: AuditLog): string {
  return JSON.stringify({
    ...log,
    version: '1.0',
    immutable: true,
  }, null, 2);
}

/**
 * Generates R2 key for log entry (organized by date for efficient querying)
 */
function generateLogKey(log: AuditLog): string {
  const date = new Date(log.timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  
  return `audit-logs/${year}/${month}/${day}/${hour}/${log.type}/${log.id}.json`;
}

/**
 * Writes audit log to R2 (immutable storage)
 */
export async function writeAuditLog(
  log: AuditLog,
  r2: R2Bucket
): Promise<void> {
  const key = generateLogKey(log);
  const content = formatLogEntry(log);
  
  await r2.put(key, content, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      logType: log.type,
      userId: log.userId,
      timestamp: String(log.timestamp),
    },
  });
}

/**
 * Creates audit log for task execution
 */
export async function logTaskExecution(
  userId: string,
  taskId: string,
  service: string,
  action: 'started' | 'completed' | 'failed',
  details: Record<string, any>,
  request: Request,
  r2: R2Bucket
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'task_execution',
    userId,
    taskId,
    service,
    action: `task_${action}`,
    details,
    metadata: {
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.headers.get('cf-connecting-ip') || undefined,
      country: request.headers.get('cf-ipcountry') || undefined,
      requestId: crypto.randomUUID(),
    },
  };
  
  await writeAuditLog(log, r2);
}

/**
 * Creates audit log for AI decisions (required for EU AI Act compliance)
 */
export async function logAIDecision(
  userId: string,
  taskId: string,
  service: string,
  decision: string,
  confidence: number,
  rationale: string,
  requiresHumanReview: boolean,
  request: Request,
  r2: R2Bucket
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'ai_decision',
    userId,
    taskId,
    service,
    action: 'ai_risk_assessment',
    details: {
      decision,
      confidence,
      rationale,
      requiresHumanReview,
      complianceFramework: 'EU AI Act Article 6',
    },
    metadata: {
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.headers.get('cf-connecting-ip') || undefined,
      country: request.headers.get('cf-ipcountry') || undefined,
      requestId: crypto.randomUUID(),
    },
  };
  
  await writeAuditLog(log, r2);
}

/**
 * Creates audit log for billing events
 */
export async function logBillingEvent(
  userId: string,
  taskId: string,
  service: string,
  amount: number,
  currency: string,
  provider: 'paddle' | 'stripe',
  request: Request,
  r2: R2Bucket
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'billing',
    userId,
    taskId,
    service,
    action: 'usage_recorded',
    details: {
      amount,
      currency,
      provider,
    },
    metadata: {
      country: request.headers.get('cf-ipcountry') || undefined,
      requestId: crypto.randomUUID(),
    },
  };
  
  await writeAuditLog(log, r2);
}

/**
 * Creates audit log for compliance checks
 */
export async function logComplianceCheck(
  userId: string,
  checkType: 'gdpr' | 'eu_ai_act' | 'data_residency',
  passed: boolean,
  details: Record<string, any>,
  request: Request,
  r2: R2Bucket
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'compliance_check',
    userId,
    action: `${checkType}_check`,
    details: {
      checkType,
      passed,
      ...details,
    },
    metadata: {
      country: request.headers.get('cf-ipcountry') || undefined,
      requestId: crypto.randomUUID(),
    },
  };
  
  await writeAuditLog(log, r2);
}

/**
 * Creates audit log for human review actions
 */
export async function logHumanReview(
  userId: string,
  taskId: string,
  assessmentId: string,
  approved: boolean,
  reviewerNotes: string,
  reviewerEmail: string,
  _request: Request,
  r2: R2Bucket
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'human_review',
    userId,
    taskId,
    action: 'human_review_completed',
    details: {
      assessmentId,
      approved,
      reviewerNotes,
      reviewerEmail,
      complianceRequirement: 'EU AI Act Article 14 - Human Oversight',
    },
    metadata: {
      requestId: crypto.randomUUID(),
    },
  };
  
  await writeAuditLog(log, r2);
}

/**
 * Queries audit logs from R2 (for compliance reporting)
 */
export async function queryAuditLogs(
  r2: R2Bucket,
  options: {
    startDate: Date;
    endDate: Date;
    logType?: string;
    userId?: string;
  }
): Promise<AuditLog[]> {
  const logs: AuditLog[] = [];
  
  // List objects with prefix based on date range
  const year = options.startDate.getUTCFullYear();
  const month = String(options.startDate.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `audit-logs/${year}/${month}/`;
  
  const listed = await r2.list({ prefix });
  
  for (const object of listed.objects) {
    const obj = await r2.get(object.key);
    if (obj) {
      const text = await obj.text();
      const log = JSON.parse(text) as AuditLog;
      
      // Filter by criteria
      if (options.logType && log.type !== options.logType) continue;
      if (options.userId && log.userId !== options.userId) continue;
      if (log.timestamp < options.startDate.getTime()) continue;
      if (log.timestamp > options.endDate.getTime()) continue;
      
      logs.push(log);
    }
  }
  
  return logs;
}
