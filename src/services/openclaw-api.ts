// OpenClaw API - Task execution engine for automation jobs
import type { Env, Task } from '../types';
import { CircuitBreaker, retryWithBackoff } from '../utils/failover';
import { AuditLogger } from '../compliance/audit-logger';

/**
 * OpenClaw API - Task execution engine
 * Processes automation jobs: scraping, form filling, scheduling
 * Pricing: $0.05 per task
 */
export class OpenClawAPI {
  private db: D1Database;
  private auditLogger: AuditLogger;
  private circuitBreaker: CircuitBreaker;
  private readonly TASK_PRICE = 0.05; // $0.05 per task

  constructor(env: Env) {
    this.db = env.DB;
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);
    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  /**
   * Create a new automation task
   */
  async createTask(
    userId: string,
    taskType: 'scraping' | 'form_filling' | 'scheduling',
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
          'openclaw',
          taskType,
          'pending',
          JSON.stringify(payload),
          Date.now(),
          0
        )
        .run();

      // Log task creation
      await this.auditLogger.log({
        event_type: 'task_created',
        service: 'openclaw',
        user_id: userId,
        task_id: taskId,
        details: { task_type: taskType },
        compliance_flags: []
      });

      return new Response(
        JSON.stringify({
          success: true,
          taskId,
          status: 'pending',
          estimatedCost: this.TASK_PRICE
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Task creation error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to create task',
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
   * Execute a task with circuit breaker and retry logic
   */
  async executeTask(taskId: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
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

      // Execute with circuit breaker and retry logic
      const result = await this.circuitBreaker.execute(async () => {
        return await retryWithBackoff(async () => {
          return await this.performTask(task);
        });
      });

      // Mark as completed
      await this.db
        .prepare('UPDATE tasks SET status = ?, completed_at = ?, result = ? WHERE id = ?')
        .bind('completed', Date.now(), JSON.stringify(result), taskId)
        .run();

      // Log task completion
      await this.auditLogger.log({
        event_type: 'task_completed',
        service: 'openclaw',
        user_id: task.user_id,
        task_id: taskId,
        details: { task_type: task.task_type },
        compliance_flags: []
      });

      return { success: true, result };
    } catch (error) {
      console.error('Task execution error:', error);

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
   * Perform the actual task based on type
   */
  private async performTask(task: Task): Promise<unknown> {
    const payload = JSON.parse(task.payload);

    switch (task.task_type) {
      case 'scraping':
        return await this.performScraping(payload);
      case 'form_filling':
        return await this.performFormFilling(payload);
      case 'scheduling':
        return await this.performScheduling(payload);
      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }

  /**
   * Web scraping implementation
   */
  private async performScraping(payload: { url: string; selectors?: string[] }): Promise<unknown> {
    try {
      const response = await fetch(payload.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      
      // Simple extraction (in production, use a proper HTML parser)
      const data: Record<string, string> = {
        url: payload.url,
        contentLength: html.length.toString(),
        title: this.extractTitle(html)
      };

      return {
        success: true,
        data,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract title from HTML (simple implementation)
   */
  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : 'No title found';
  }

  /**
   * Form filling implementation
   */
  private async performFormFilling(payload: { url: string; fields: Record<string, string> }): Promise<unknown> {
    try {
      const formData = new URLSearchParams(payload.fields);
      
      const response = await fetch(payload.url, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        success: true,
        status: response.status,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Form filling failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Scheduling implementation
   */
  private async performScheduling(payload: { action: string; schedule: string }): Promise<unknown> {
    // In production, this would integrate with a scheduling service
    return {
      success: true,
      scheduled: true,
      action: payload.action,
      schedule: payload.schedule,
      timestamp: Date.now()
    };
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<Response> {
    try {
      const task = await this.db
        .prepare('SELECT * FROM tasks WHERE id = ?')
        .bind(taskId)
        .first<Task>();

      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(
        JSON.stringify({
          taskId: task.id,
          status: task.status,
          createdAt: task.created_at,
          startedAt: task.started_at,
          completedAt: task.completed_at,
          result: task.result ? JSON.parse(task.result) : null,
          error: task.last_error
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Failed to get task status',
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
