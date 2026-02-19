/**
 * OpenClaw API: Generic task execution engine
 * Orchestrates AI tasks with self-healing retry logic
 */

import { retryWithBackoff, DEFAULT_RETRY_CONFIG } from '../utils/failover';
import { logTaskExecution } from '../compliance/audit-logger';

export interface Task {
  id: string;
  userId: string;
  serviceType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface OpenClawEnv {
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

/**
 * Creates a new task in the queue
 */
export async function createTask(
  env: OpenClawEnv,
  userId: string,
  serviceType: string,
  payload: Record<string, unknown>,
  request?: Request
): Promise<Task> {
  const taskId = crypto.randomUUID();
  const now = Date.now();
  
  const task: Task = {
    id: taskId,
    userId,
    serviceType,
    payload,
    status: 'pending',
    retryCount: 0,
  };
  
  // Store in database
  await env.DB.prepare(`
    INSERT INTO tasks (id, user_id, service_type, payload, status, retry_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    taskId,
    userId,
    serviceType,
    JSON.stringify(payload),
    'pending',
    0,
    now,
    now
  ).run();
  
  // Log task creation
  await logTaskExecution(env, taskId, userId, serviceType, 'created', payload, request);
  
  return task;
}

/**
 * Executes a task with retry logic
 */
export async function executeTask(
  env: OpenClawEnv,
  taskId: string,
  executor: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
  request?: Request
): Promise<Task> {
  // Get task from database
  const taskRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  
  if (!taskRow) {
    throw new Error('Task not found');
  }
  
  const task: Task = {
    id: taskRow.id as string,
    userId: taskRow.user_id as string,
    serviceType: taskRow.service_type as string,
    payload: JSON.parse(taskRow.payload as string),
    status: taskRow.status as Task['status'],
    retryCount: taskRow.retry_count as number,
  };
  
  // Update status to processing
  await env.DB.prepare(`
    UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
  `).bind('processing', Date.now(), taskId).run();
  
  await logTaskExecution(env, taskId, task.userId, task.serviceType, 'started', {}, request);
  
  try {
    // Execute with retry logic
    const result = await retryWithBackoff(
      () => executor(task.payload),
      DEFAULT_RETRY_CONFIG,
      async (attempt, error) => {
        // Update retry count
        await env.DB.prepare(`
          UPDATE tasks SET retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?
        `).bind(attempt, error.message, Date.now(), taskId).run();
      }
    );
    
    // Mark as completed
    task.status = 'completed';
    task.result = result;
    
    await env.DB.prepare(`
      UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `).bind('completed', Date.now(), Date.now(), taskId).run();
    
    await logTaskExecution(env, taskId, task.userId, task.serviceType, 'completed', result, request);
    
  } catch (error) {
    // Max retries exceeded, mark as failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    task.status = 'failed';
    task.error = errorMessage;
    
    await env.DB.prepare(`
      UPDATE tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ?
    `).bind('failed', errorMessage, Date.now(), taskId).run();
    
    // Add to failed tasks queue for cron reprocessing
    await env.DB.prepare(`
      INSERT INTO failed_tasks (id, task_id, user_id, service_type, payload, error_message, retry_count, failed_at, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      taskId,
      task.userId,
      task.serviceType,
      JSON.stringify(task.payload),
      errorMessage,
      task.retryCount,
      Date.now(),
      Date.now() + (5 * 60 * 1000) // Retry in 5 minutes
    ).run();
    
    await logTaskExecution(env, taskId, task.userId, task.serviceType, 'failed', { error: errorMessage }, request);
  }
  
  return task;
}

/**
 * Gets task status
 */
export async function getTask(env: OpenClawEnv, taskId: string): Promise<Task | null> {
  const taskRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  
  if (!taskRow) {
    return null;
  }
  
  const task: Task = {
    id: taskRow.id as string,
    userId: taskRow.user_id as string,
    serviceType: taskRow.service_type as string,
    payload: JSON.parse(taskRow.payload as string),
    status: taskRow.status as Task['status'],
    retryCount: taskRow.retry_count as number,
  };
  
  if (taskRow.last_error) {
    task.error = taskRow.last_error as string;
  }
  
  return task;
}

/**
 * Reprocesses failed tasks (called by cron trigger)
 */
export async function reprocessFailedTasks(env: OpenClawEnv): Promise<number> {
  const now = Date.now();
  
  // Get failed tasks ready for retry
  const failedTasks = await env.DB.prepare(`
    SELECT * FROM failed_tasks WHERE next_retry_at <= ?
  `).bind(now).all();
  
  let reprocessedCount = 0;
  
  for (const row of failedTasks.results) {
    try {
      const taskId = row.task_id as string;
      
      // Reset task status to pending
      await env.DB.prepare(`
        UPDATE tasks SET status = ?, retry_count = 0, updated_at = ? WHERE id = ?
      `).bind('pending', now, taskId).run();
      
      // Remove from failed tasks queue
      await env.DB.prepare('DELETE FROM failed_tasks WHERE id = ?').bind(row.id).run();
      
      reprocessedCount++;
    } catch (error) {
      console.error('Error reprocessing task:', error);
    }
  }
  
  return reprocessedCount;
}
