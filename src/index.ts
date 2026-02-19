/**
 * Omniclaws: Global Edge-Based AI Monetization Platform
 * Main Worker Entry Point - Routes all requests and orchestrates services
 */

import { getGeoLocation } from './utils/geo-router';
import { getNextRetryTime, shouldRetry } from './utils/failover';
import { recordUsage } from './billing/router';
import { logTaskExecution, logComplianceCheck } from './compliance/audit-logger';
import { checkDataResidency } from './compliance/gdpr';
import { executeTask, createTask, getTaskStatus } from './services/openclaw-api';
import { screenCandidate, getPendingReviews } from './services/q-emplois';
import { executeContentArbitrage } from './services/zyeute-content';

/**
 * Cloudflare Worker Environment
 */
export interface Env {
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
  CACHE?: KVNamespace;
  PADDLE_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  OPENAI_API_KEY?: string;
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Extract geo-location from Cloudflare headers
    const geo = getGeoLocation(request);
    
    // Parse URL
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS headers for API access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle OPTIONS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Route requests
      if (path === '/' || path === '/health') {
        return handleHealthCheck(geo, corsHeaders);
      }
      
      if (path === '/api/task' && request.method === 'POST') {
        return await handleTaskExecution(request, env, geo, corsHeaders);
      }
      
      if (path.startsWith('/api/task/') && request.method === 'GET') {
        return await handleTaskStatus(path, env, corsHeaders);
      }
      
      if (path === '/api/billing/summary' && request.method === 'GET') {
        return await handleBillingSummary(request, env, corsHeaders);
      }
      
      if (path === '/api/reviews/pending' && request.method === 'GET') {
        return await handlePendingReviews(env, corsHeaders);
      }
      
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Request handling error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
  
  /**
   * Scheduled handler for failed task reprocessing (runs every 5 minutes)
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('Running scheduled task reprocessing...');
    
    try {
      await reprocessFailedTasks(env);
    } catch (error) {
      console.error('Scheduled task error:', error);
    }
  },
};

/**
 * Health check endpoint
 */
function handleHealthCheck(geo: any, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'Omniclaws',
      version: '1.0.0',
      edge_location: geo.country,
      billing_provider: geo.billingProvider,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Handles task execution requests
 */
async function handleTaskExecution(
  request: Request,
  env: Env,
  geo: any,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Authenticate user (simplified - in production use proper auth)
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing API key' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Get user from database
  const user = await env.DB
    .prepare('SELECT * FROM users WHERE api_key = ?')
    .bind(apiKey)
    .first();
  
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Invalid API key' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const userId = (user as any).id;
  
  // Check GDPR data residency
  const residencyCheck = checkDataResidency(geo.country);
  await logComplianceCheck(userId, 'data_residency', residencyCheck.allowed, residencyCheck, request, env.AUDIT_LOGS);
  
  if (!residencyCheck.allowed) {
    return new Response(
      JSON.stringify({ error: 'Data residency violation', details: residencyCheck }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Parse request body
  const body = await request.json() as any;
  const service = body.service || 'openclaw-api';
  const input = body.input;
  
  // Create task
  const taskId = await createTask(userId, service, input, env.DB);
  
  // Log task start
  await logTaskExecution(userId, taskId, service, 'started', { input }, request, env.AUDIT_LOGS);
  
  try {
    let result: any;
    
    // Route to appropriate service
    if (service === 'q-emplois') {
      result = await screenCandidate(taskId, userId, input, env.DB, env.AUDIT_LOGS, request);
    } else if (service === 'zyeute-content') {
      result = await executeContentArbitrage(taskId, userId, input, env.DB);
    } else {
      result = await executeTask(taskId, userId, input, env.DB);
    }
    
    // Record usage for billing
    const billingResult = await recordUsage(userId, taskId, service, geo.country, env.DB, env);
    
    // Log task completion
    await logTaskExecution(userId, taskId, service, 'completed', { result, billing: billingResult }, request, env.AUDIT_LOGS);
    
    return new Response(
      JSON.stringify({
        success: true,
        taskId,
        result,
        billing: {
          provider: geo.billingProvider,
          charged: billingResult.success,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    // Handle task failure
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Add to failed tasks queue if retryable
    if (shouldRetry(error as Error)) {
      const retryCount = 0;
      const nextRetryAt = Math.floor(getNextRetryTime(retryCount) / 1000);
      
      await env.DB
        .prepare(
          `INSERT INTO failed_tasks (id, task_id, user_id, service, input, error, retry_count, next_retry_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          taskId,
          userId,
          service,
          JSON.stringify(input),
          errorMessage,
          retryCount,
          nextRetryAt,
          Math.floor(Date.now() / 1000)
        )
        .run();
    }
    
    // Log task failure
    await logTaskExecution(userId, taskId, service, 'failed', { error: errorMessage }, request, env.AUDIT_LOGS);
    
    return new Response(
      JSON.stringify({ success: false, taskId, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handles task status requests
 */
async function handleTaskStatus(
  path: string,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const taskId = path.split('/').pop();
  
  if (!taskId) {
    return new Response(
      JSON.stringify({ error: 'Task ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const task = await getTaskStatus(taskId, env.DB);
  
  if (!task) {
    return new Response(
      JSON.stringify({ error: 'Task not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  return new Response(JSON.stringify(task), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Handles billing summary requests
 */
async function handleBillingSummary(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing API key' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const user = await env.DB
    .prepare('SELECT * FROM users WHERE api_key = ?')
    .bind(apiKey)
    .first();
  
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Invalid API key' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const userId = (user as any).id;
  
  // Get billing summary for last 30 days
  const { getBillingSummary } = await import('./billing/router');
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const summary = await getBillingSummary(userId, startDate, endDate, env.DB);
  
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Handles pending human review requests
 */
async function handlePendingReviews(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const reviews = await getPendingReviews(env.DB);
  
  return new Response(JSON.stringify({ count: reviews.length, reviews }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Reprocesses failed tasks (called by cron every 5 minutes)
 */
async function reprocessFailedTasks(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  
  // Get failed tasks ready for retry
  const failedTasks = await env.DB
    .prepare(
      'SELECT * FROM failed_tasks WHERE next_retry_at <= ? AND retry_count < 3 ORDER BY created_at ASC LIMIT 10'
    )
    .bind(now)
    .all();
  
  for (const task of failedTasks.results || []) {
    const t = task as any;
    
    try {
      // Attempt to retry the task
      const input = JSON.parse(t.input);
      
      let result: any;
      if (t.service === 'q-emplois') {
        // For high-risk AI, we need a mock request object
        const mockRequest = new Request('https://omniclaws.com/api/task', {
          method: 'POST',
          headers: { 'cf-ipcountry': 'US' },
        });
        result = await screenCandidate(t.task_id, t.user_id, input, env.DB, env.AUDIT_LOGS, mockRequest);
      } else if (t.service === 'zyeute-content') {
        result = await executeContentArbitrage(t.task_id, t.user_id, input, env.DB);
      } else {
        result = await executeTask(t.task_id, t.user_id, input, env.DB);
      }
      
      if (result.success) {
        // Remove from failed tasks queue
        await env.DB
          .prepare('DELETE FROM failed_tasks WHERE id = ?')
          .bind(t.id)
          .run();
        
        console.log(`Successfully retried task ${t.task_id}`);
      } else {
        throw new Error(result.error || 'Task failed');
      }
    } catch (error) {
      // Increment retry count and update next retry time
      const newRetryCount = t.retry_count + 1;
      const nextRetryAt = Math.floor(getNextRetryTime(newRetryCount) / 1000);
      
      await env.DB
        .prepare(
          'UPDATE failed_tasks SET retry_count = ?, next_retry_at = ?, error = ? WHERE id = ?'
        )
        .bind(newRetryCount, nextRetryAt, error instanceof Error ? error.message : 'Unknown error', t.id)
        .run();
      
      console.error(`Retry ${newRetryCount} failed for task ${t.task_id}:`, error);
    }
  }
}
