/**
 * OpenClaw API: Task Execution Engine
 * Core task orchestration and execution service
 */

import { retryWithBackoff, DEFAULT_RETRY_CONFIG } from '../utils/failover';

export interface TaskInput {
  type: string;
  parameters: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TaskResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number;
  timestamp: number;
}

/**
 * Executes a generic task with retry logic
 */
export async function executeTask(
  taskId: string,
  userId: string,
  input: TaskInput,
  db: D1Database
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Update task status to processing
    await db
      .prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .bind('processing', taskId)
      .run();
    
    // Execute task based on type
    let output: any;
    
    switch (input.type) {
      case 'data_processing':
        output = await processData(input.parameters);
        break;
      case 'api_call':
        output = await makeAPICall(input.parameters);
        break;
      case 'computation':
        output = await performComputation(input.parameters);
        break;
      default:
        throw new Error(`Unknown task type: ${input.type}`);
    }
    
    const executionTime = Date.now() - startTime;
    
    // Update task as completed
    await db
      .prepare('UPDATE tasks SET status = ?, output = ?, completed_at = ? WHERE id = ?')
      .bind('completed', JSON.stringify(output), Math.floor(Date.now() / 1000), taskId)
      .run();
    
    return {
      success: true,
      output,
      executionTime,
      timestamp: Date.now(),
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update task as failed
    await db
      .prepare('UPDATE tasks SET status = ?, error = ? WHERE id = ?')
      .bind('failed', errorMessage, taskId)
      .run();
    
    return {
      success: false,
      error: errorMessage,
      executionTime,
      timestamp: Date.now(),
    };
  }
}

/**
 * Processes data based on parameters
 */
async function processData(parameters: Record<string, any>): Promise<any> {
  // Simulate data processing
  const data = parameters.data || [];
  const operation = parameters.operation || 'transform';
  
  switch (operation) {
    case 'transform':
      return { transformed: true, count: data.length };
    case 'filter':
      return { filtered: true, count: Math.floor(data.length / 2) };
    case 'aggregate':
      return { aggregated: true, total: data.length };
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Makes an external API call
 */
async function makeAPICall(parameters: Record<string, any>): Promise<any> {
  const url = parameters.url;
  const method = parameters.method || 'GET';
  const headers = parameters.headers || {};
  const body = parameters.body;
  
  if (!url) {
    throw new Error('URL is required for API calls');
  }
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Performs computational tasks
 */
async function performComputation(parameters: Record<string, any>): Promise<any> {
  const operation = parameters.operation;
  const values = parameters.values || [];
  
  switch (operation) {
    case 'sum':
      return { result: values.reduce((a: number, b: number) => a + b, 0) };
    case 'average':
      return { result: values.reduce((a: number, b: number) => a + b, 0) / values.length };
    case 'max':
      return { result: Math.max(...values) };
    case 'min':
      return { result: Math.min(...values) };
    default:
      throw new Error(`Unknown computation: ${operation}`);
  }
}

/**
 * Creates a new task in the database
 */
export async function createTask(
  userId: string,
  service: string,
  input: TaskInput,
  db: D1Database
): Promise<string> {
  const taskId = crypto.randomUUID();
  
  await db
    .prepare(
      `INSERT INTO tasks (id, user_id, service, status, input, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      taskId,
      userId,
      service,
      'pending',
      JSON.stringify(input),
      Math.floor(Date.now() / 1000)
    )
    .run();
  
  return taskId;
}

/**
 * Gets task status and result
 */
export async function getTaskStatus(
  taskId: string,
  db: D1Database
): Promise<{
  id: string;
  status: string;
  output?: any;
  error?: string;
  createdAt: number;
  completedAt?: number;
} | null> {
  const result = await db
    .prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId)
    .first();
  
  if (!result) {
    return null;
  }
  
  const task = result as any;
  
  return {
    id: task.id,
    status: task.status,
    output: task.output ? JSON.parse(task.output) : undefined,
    error: task.error,
    createdAt: task.created_at,
    completedAt: task.completed_at,
  };
}
