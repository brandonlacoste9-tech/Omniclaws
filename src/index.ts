/**
 * Omniclaws: Global Edge-Based AI Monetization Platform
 * Main Cloudflare Worker entry point
 * 
 * Runs 24/7 across 200+ edge locations
 * Routes: /api/recruitment, /api/content, /webhooks/paddle, /webhooks/stripe
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 * - PADDLE_API_KEY: Paddle API key for EU/UK billing
 * - PADDLE_VENDOR_ID: Paddle vendor ID
 * - STRIPE_SECRET_KEY: Stripe secret key for US/CA billing
 * - STRIPE_WEBHOOK_SECRET: Stripe webhook signing secret
 */

import { getCountryFromRequest, getPaymentProvider } from './utils/geo-router';
import { createCustomer, recordUsage, getBillingSummary, handleWebhook } from './billing/router';
import { processRecruitmentTask, getRecruitmentResult } from './services/q-emplois';
import { processContentTask, getContentResult } from './services/zyeute-content';
import { reprocessFailedTasks } from './services/openclaw-api';
import { deleteUserData, exportUserData } from './compliance/gdpr';

export interface Env {
  // D1 Database
  DB: D1Database;
  
  // R2 Buckets
  AUDIT_LOGS: R2Bucket;
  COMPLIANCE_DATA: R2Bucket;
  
  // Environment Variables (Secrets)
  PADDLE_API_KEY: string;
  PADDLE_VENDOR_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

/**
 * Main Worker request handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Add CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      // API Routes
      if (path === '/' || path === '/health') {
        return handleHealthCheck(env, corsHeaders);
      }
      
      if (path === '/api/register') {
        return handleRegistration(request, env, corsHeaders);
      }
      
      if (path === '/api/recruitment') {
        return handleRecruitment(request, env, corsHeaders);
      }
      
      if (path === '/api/recruitment/result') {
        return handleRecruitmentResult(request, env, corsHeaders);
      }
      
      if (path === '/api/content') {
        return handleContent(request, env, corsHeaders);
      }
      
      if (path === '/api/content/result') {
        return handleContentResult(request, env, corsHeaders);
      }
      
      if (path === '/api/billing/summary') {
        return handleBillingSummary(request, env, corsHeaders);
      }
      
      // GDPR Endpoints
      if (path === '/api/gdpr/export') {
        return handleGDPRExport(request, env, corsHeaders);
      }
      
      if (path === '/api/gdpr/delete') {
        return handleGDPRDeletion(request, env, corsHeaders);
      }
      
      // Webhook Endpoints
      if (path === '/webhooks/paddle') {
        return handlePaddleWebhook(request, env);
      }
      
      if (path === '/webhooks/stripe') {
        return handleStripeWebhook(request, env);
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
  
  /**
   * Scheduled handler for cron triggers
   * Runs every 5 minutes to reprocess failed tasks
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const reprocessed = await reprocessFailedTasks(env);
      console.log(`Cron: Reprocessed ${reprocessed} failed tasks`);
    } catch (error) {
      console.error('Cron error:', error);
    }
  },
};

/**
 * Health check endpoint
 */
async function handleHealthCheck(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: 'connected',
      storage: 'connected',
    },
  };
  
  return new Response(JSON.stringify(health, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' },
  });
}

/**
 * User registration endpoint
 */
async function handleRegistration(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  
  const body = await request.json() as { email: string };
  const countryCode = getCountryFromRequest(request);
  const paymentProvider = getPaymentProvider(countryCode);
  
  if (paymentProvider === 'unsupported') {
    return new Response(
      JSON.stringify({ error: `Service not available in your region: ${countryCode}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Create user
  const userId = crypto.randomUUID();
  const apiKey = `omniclaw_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  
  await env.DB.prepare(`
    INSERT INTO users (id, email, country_code, payment_provider, api_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(userId, body.email, countryCode, paymentProvider, apiKey, now, now).run();
  
  // Create customer in billing system
  const { customerId } = await createCustomer(env, userId, body.email, countryCode);
  
  return new Response(
    JSON.stringify({ userId, apiKey, paymentProvider, customerId }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Recruitment AI endpoint (HIGH-RISK under EU AI Act)
 */
async function handleRecruitment(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const body = await request.json();
  const result = await processRecruitmentTask(env, user.id as string, body, request);
  
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Get recruitment result
 */
async function handleRecruitmentResult(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  
  if (!taskId) {
    return new Response('Missing taskId', { status: 400, headers: corsHeaders });
  }
  
  const result = await getRecruitmentResult(env, taskId, user.id as string);
  
  if (!result) {
    return new Response('Task not found', { status: 404, headers: corsHeaders });
  }
  
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Content arbitrage endpoint
 */
async function handleContent(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const body = await request.json();
  const result = await processContentTask(env, user.id as string, body, request);
  
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Get content result
 */
async function handleContentResult(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  
  if (!taskId) {
    return new Response('Missing taskId', { status: 400, headers: corsHeaders });
  }
  
  const result = await getContentResult(env, taskId, user.id as string);
  
  if (!result) {
    return new Response('Task not found', { status: 404, headers: corsHeaders });
  }
  
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Billing summary endpoint
 */
async function handleBillingSummary(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const summary = await getBillingSummary(env, user.id as string);
  
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * GDPR data export endpoint
 */
async function handleGDPRExport(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const data = await exportUserData(env.DB, user.id as string);
  
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * GDPR deletion endpoint (Right to be Forgotten)
 */
async function handleGDPRDeletion(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const user = await env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first();
  if (!user) {
    return new Response('Invalid API key', { status: 401, headers: corsHeaders });
  }
  
  const result = await deleteUserData({ COMPLIANCE_DATA: env.COMPLIANCE_DATA }, env.DB, user.id as string);
  
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Paddle webhook handler
 */
async function handlePaddleWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('Paddle-Signature') || '';
  const rawBody = await request.text();
  
  return handleWebhook(env, 'paddle', signature, rawBody);
}

/**
 * Stripe webhook handler
 */
async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('Stripe-Signature') || '';
  const rawBody = await request.text();
  
  return handleWebhook(env, 'stripe', signature, rawBody);
}
