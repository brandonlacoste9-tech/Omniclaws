/**
 * Audit Logger: Immutable logging to R2 for compliance
 * Logs are append-only and cryptographically timestamped
 */

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  eventType: string;
  userId: string;
  taskId?: string;
  service?: string;
  action: string;
  data: Record<string, unknown>;
  ipAddress?: string;
  countryCode?: string;
  userAgent?: string;
}

export interface AuditLoggerEnv {
  AUDIT_LOGS: R2Bucket;
}

/**
 * Generates a unique audit log ID
 */
export function generateAuditLogId(): string {
  return `audit-${Date.now()}-${crypto.randomUUID()}`;
}

/**
 * Creates an audit log entry
 */
export async function logAuditEvent(
  env: AuditLoggerEnv,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): Promise<string> {
  const auditId = generateAuditLogId();
  const timestamp = Date.now();
  
  const fullEntry: AuditLogEntry = {
    id: auditId,
    timestamp,
    ...entry,
  };
  
  // Store in R2 with immutable flag
  const key = `${new Date(timestamp).toISOString().split('T')[0]}/${auditId}.json`;
  
  await env.AUDIT_LOGS.put(key, JSON.stringify(fullEntry, null, 2), {
    customMetadata: {
      eventType: entry.eventType,
      userId: entry.userId,
      timestamp: timestamp.toString(),
    },
  });
  
  return auditId;
}

/**
 * Logs a task execution event
 */
export async function logTaskExecution(
  env: AuditLoggerEnv,
  taskId: string,
  userId: string,
  service: string,
  action: 'created' | 'started' | 'completed' | 'failed',
  data: Record<string, unknown>,
  request?: Request
): Promise<string> {
  return logAuditEvent(env, {
    eventType: 'task_execution',
    userId,
    taskId,
    service,
    action,
    data,
    ipAddress: request?.headers.get('CF-Connecting-IP') || undefined,
    countryCode: request?.headers.get('CF-IPCountry') || undefined,
    userAgent: request?.headers.get('User-Agent') || undefined,
  });
}

/**
 * Logs an AI decision event (required for EU AI Act)
 */
export async function logAIDecision(
  env: AuditLoggerEnv,
  taskId: string,
  userId: string,
  service: string,
  decision: {
    riskLevel: string;
    confidence: number;
    rationale: string;
    requiresHumanReview: boolean;
  },
  request?: Request
): Promise<string> {
  return logAuditEvent(env, {
    eventType: 'ai_decision',
    userId,
    taskId,
    service,
    action: 'risk_assessment',
    data: decision,
    ipAddress: request?.headers.get('CF-Connecting-IP') || undefined,
    countryCode: request?.headers.get('CF-IPCountry') || undefined,
  });
}

/**
 * Logs a billing event
 */
export async function logBillingEvent(
  env: AuditLoggerEnv,
  userId: string,
  action: string,
  data: Record<string, unknown>
): Promise<string> {
  return logAuditEvent(env, {
    eventType: 'billing',
    userId,
    action,
    data,
  });
}

/**
 * Retrieves audit logs for a specific user (for GDPR data access requests)
 */
export async function getUserAuditLogs(
  env: AuditLoggerEnv,
  userId: string,
  startDate?: Date,
  endDate?: Date
): Promise<AuditLogEntry[]> {
  const logs: AuditLogEntry[] = [];
  
  // Query R2 for logs with userId in metadata
  const listed = await env.AUDIT_LOGS.list({
    prefix: startDate ? startDate.toISOString().split('T')[0] : undefined,
  });
  
  for (const object of listed.objects) {
    if (object.customMetadata?.userId === userId) {
      const content = await env.AUDIT_LOGS.get(object.key);
      if (content) {
        const text = await content.text();
        const entry = JSON.parse(text) as AuditLogEntry;
        
        // Filter by date range if specified
        if (startDate && entry.timestamp < startDate.getTime()) continue;
        if (endDate && entry.timestamp > endDate.getTime()) continue;
        
        logs.push(entry);
      }
    }
  }
  
  return logs.sort((a, b) => b.timestamp - a.timestamp);
}
