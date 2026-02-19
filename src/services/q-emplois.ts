// Q-Emplois - Recruitment AI (EU AI Act High-Risk Classification)
import type { Env, Task, AIDecision } from '../types';
import { EUAIActMonitor } from '../compliance/eu-ai-act';
import { AuditLogger } from '../compliance/audit-logger';
import { CircuitBreaker } from '../utils/failover';

/**
 * Q-Emplois - Recruitment AI System
 * Classified as EU AI Act "high-risk" (Annex III - employment)
 * Requirements:
 * - Human-in-the-loop for confidence < 0.95
 * - Full audit trails
 * - CE marking compliance
 */
export class QEmploisService {
  private db: D1Database;
  private aiActMonitor: EUAIActMonitor;
  private auditLogger: AuditLogger;
  private circuitBreaker: CircuitBreaker;
  private readonly CONFIDENCE_THRESHOLD = 0.95;

  constructor(env: Env) {
    this.db = env.DB;
    this.aiActMonitor = new EUAIActMonitor(env);
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);
    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  /**
   * Create a recruitment AI task
   */
  async createRecruitmentTask(
    userId: string,
    taskType: 'candidate_screening' | 'job_matching' | 'skill_assessment',
    payload: unknown
  ): Promise<Response> {
    try {
      const taskId = crypto.randomUUID();

      // Insert task into queue
      await this.db
        .prepare(
          `INSERT INTO tasks 
          (id, user_id, service, task_type, status, payload, created_at, retry_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          taskId,
          userId,
          'q-emplois',
          taskType,
          'pending',
          JSON.stringify(payload),
          Date.now(),
          0
        )
        .run();

      // Log task creation with high-risk flag
      await this.auditLogger.log({
        event_type: 'task_created',
        service: 'q-emplois',
        user_id: userId,
        task_id: taskId,
        details: { task_type: taskType },
        compliance_flags: ['EU_AI_ACT_HIGH_RISK', 'EMPLOYMENT_AI']
      });

      return new Response(
        JSON.stringify({
          success: true,
          taskId,
          status: 'pending',
          complianceNotice: 'This is a high-risk AI system under EU AI Act. Human oversight may be required.'
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Q-Emplois task creation error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to create recruitment task',
          details: error instanceof Error ? error.message : 'Unknown error'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

  /**
   * Execute recruitment AI task with EU AI Act compliance
   */
  async executeTask(taskId: string): Promise<{ success: boolean; result?: unknown; requiresHumanReview?: boolean; error?: string }> {
    try {
      // Get task from database
      const task = await this.db
        .prepare('SELECT * FROM tasks WHERE id = ?')
        .bind(taskId)
        .first<Task>();

      if (!task) {
        return { success: false, error: 'Task not found' };
      }

      // Mark as processing
      await this.db
        .prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?')
        .bind('processing', Date.now(), taskId)
        .run();

      // Execute AI decision with circuit breaker
      const aiDecision = await this.circuitBreaker.execute(async () => {
        return await this.makeAIDecision(task);
      });

      // Evaluate decision against EU AI Act requirements
      const evaluation = await this.aiActMonitor.evaluateDecision(
        task.user_id,
        taskId,
        'q-emplois',
        aiDecision
      );

      if (evaluation.requiresReview) {
        // Task requires human review - do not complete yet
        await this.db
          .prepare('UPDATE tasks SET status = ? WHERE id = ?')
          .bind('pending', taskId) // Keep pending until human review
          .run();

        return {
          success: false,
          requiresHumanReview: true,
          result: {
            oversightId: evaluation.oversightId,
            message: 'This decision requires human oversight due to confidence level or high-risk classification'
          }
        };
      }

      // Auto-approved - complete the task
      await this.db
        .prepare('UPDATE tasks SET status = ?, completed_at = ?, result = ? WHERE id = ?')
        .bind('completed', Date.now(), JSON.stringify(aiDecision.recommendation), taskId)
        .run();

      return { success: true, result: aiDecision.recommendation };
    } catch (error) {
      console.error('Q-Emplois execution error:', error);

      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.db
        .prepare('UPDATE tasks SET status = ?, last_error = ? WHERE id = ?')
        .bind('failed', errorMessage, taskId)
        .run();

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Make AI decision for recruitment task
   */
  private async makeAIDecision(task: Task): Promise<AIDecision> {
    const payload = JSON.parse(task.payload);

    switch (task.task_type) {
      case 'candidate_screening':
        return await this.screenCandidate(payload);
      case 'job_matching':
        return await this.matchJob(payload);
      case 'skill_assessment':
        return await this.assessSkills(payload);
      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }

  /**
   * Screen candidate (mock AI implementation)
   */
  private async screenCandidate(payload: { resume: string; requirements: string[] }): Promise<AIDecision> {
    // Mock AI decision - in production, this would call an actual AI model
    const confidence = Math.random() * 0.4 + 0.6; // 0.6-1.0 range
    
    const recommendation = {
      decision: confidence > 0.85 ? 'qualified' : 'needs_review',
      matchedRequirements: payload.requirements.slice(0, Math.floor(payload.requirements.length * confidence)),
      score: Math.round(confidence * 100)
    };

    return {
      confidence,
      recommendation,
      requiresHumanReview: confidence < this.CONFIDENCE_THRESHOLD,
      reasoning: `AI confidence: ${(confidence * 100).toFixed(1)}%. ${confidence < this.CONFIDENCE_THRESHOLD ? 'Requires human review.' : 'Auto-approved.'}`
    };
  }

  /**
   * Match job to candidates (mock AI implementation)
   */
  private async matchJob(payload: { jobDescription: string; candidatePool: string[] }): Promise<AIDecision> {
    const confidence = Math.random() * 0.4 + 0.6;
    
    const recommendation = {
      topCandidates: payload.candidatePool.slice(0, Math.min(5, payload.candidatePool.length)),
      matchScores: payload.candidatePool.slice(0, 5).map(() => Math.random() * 0.4 + 0.6)
    };

    return {
      confidence,
      recommendation,
      requiresHumanReview: confidence < this.CONFIDENCE_THRESHOLD,
      reasoning: `AI confidence: ${(confidence * 100).toFixed(1)}%`
    };
  }

  /**
   * Assess skills (mock AI implementation)
   */
  private async assessSkills(payload: { candidateId: string; skills: string[] }): Promise<AIDecision> {
    const confidence = Math.random() * 0.4 + 0.6;
    
    const recommendation = {
      assessedSkills: payload.skills.map(skill => ({
        skill,
        level: Math.floor(Math.random() * 5) + 1,
        verified: Math.random() > 0.3
      }))
    };

    return {
      confidence,
      recommendation,
      requiresHumanReview: confidence < this.CONFIDENCE_THRESHOLD,
      reasoning: `AI confidence: ${(confidence * 100).toFixed(1)}%`
    };
  }

  /**
   * Get pending human oversight items
   */
  async getPendingReviews(): Promise<Response> {
    try {
      const items = await this.aiActMonitor.getPendingOversight(50);

      return new Response(
        JSON.stringify({
          success: true,
          count: items.length,
          items
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Failed to get pending reviews',
          details: error instanceof Error ? error.message : 'Unknown error'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

  /**
   * Submit human review decision
   */
  async submitReview(
    oversightId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    reasoning: string
  ): Promise<Response> {
    try {
      await this.aiActMonitor.processHumanReview(oversightId, reviewerId, decision, reasoning);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Review processed successfully'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Failed to process review',
          details: error instanceof Error ? error.message : 'Unknown error'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
}
