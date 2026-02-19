import { BillingRouter } from './billing/router';
import { OpenClawAPI } from './services/openclaw-api';
import { QEmploisService } from './services/q-emplois';
import { ZyeuteContentService } from './services/zyeute-content';
import { determineRegion, requiresGDPR } from './utils/geo-router';
import { FailedTaskQueue } from './utils/failover';
import { AuditLogger } from './compliance/audit-logger';
/**
 * Main worker entry point
 * Handles routing, caching, and CORS
 */
export default {
    async fetch(request, env) {
        try {
            // CORS headers
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            };
            // Handle CORS preflight
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: corsHeaders
                });
            }
            const url = new URL(request.url);
            const path = url.pathname;
            // Initialize services
            const billingRouter = new BillingRouter(env);
            const openClawAPI = new OpenClawAPI(env);
            const qEmplois = new QEmploisService(env);
            const zyeute = new ZyeuteContentService(env);
            // Get geo-location from Cloudflare headers
            const geoLocation = {
                country: request.headers.get('cf-ipcountry') || undefined,
                continent: undefined,
                region: undefined
            };
            // Route handling with aggressive caching
            let response;
            // Health check
            if (path === '/health') {
                response = new Response(JSON.stringify({ status: 'healthy', timestamp: Date.now() }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // User registration
            else if (path === '/api/users/register' && request.method === 'POST') {
                response = await handleUserRegistration(request, env, geoLocation);
            }
            // OpenClaw API routes
            else if (path.startsWith('/api/openclaw/tasks')) {
                if (request.method === 'POST') {
                    const { userId, taskType, payload } = await request.json();
                    response = await openClawAPI.createTask(userId, taskType, payload);
                    // Record usage for billing
                    const result = await response.clone().json();
                    if (result.taskId) {
                        await billingRouter.recordUsage(userId, 'openclaw', result.taskId, 0.05);
                    }
                }
                else if (request.method === 'GET') {
                    const taskId = url.searchParams.get('taskId');
                    if (!taskId) {
                        response = new Response(JSON.stringify({ error: 'taskId required' }), { status: 400 });
                    }
                    else {
                        response = await openClawAPI.getTaskStatus(taskId);
                    }
                }
                else {
                    response = new Response('Method not allowed', { status: 405 });
                }
            }
            // Q-Emplois routes (high-risk AI)
            else if (path.startsWith('/api/q-emplois/tasks')) {
                if (request.method === 'POST') {
                    const { userId, taskType, payload } = await request.json();
                    response = await qEmplois.createRecruitmentTask(userId, taskType, payload);
                }
                else {
                    response = new Response('Method not allowed', { status: 405 });
                }
            }
            else if (path === '/api/q-emplois/oversight' && request.method === 'GET') {
                response = await qEmplois.getPendingReviews();
            }
            else if (path === '/api/q-emplois/oversight/review' && request.method === 'POST') {
                const { oversightId, reviewerId, decision, reasoning } = await request.json();
                response = await qEmplois.submitReview(oversightId, reviewerId, decision, reasoning);
            }
            // Zyeuté Content routes
            else if (path.startsWith('/api/zyeute/tasks')) {
                if (request.method === 'POST') {
                    const { userId, taskType, payload } = await request.json();
                    response = await zyeute.createContentTask(userId, taskType, payload);
                }
                else {
                    response = new Response('Method not allowed', { status: 405 });
                }
            }
            else if (path === '/api/zyeute/workflow' && request.method === 'POST') {
                const { userId, feedUrl, affiliateLinks } = await request.json();
                response = await zyeute.processArbitrageWorkflow(userId, feedUrl, affiliateLinks);
            }
            // Billing routes
            else if (path === '/api/billing/payment' && request.method === 'POST') {
                const { userId, amount, currency } = await request.json();
                response = await billingRouter.processPayment(userId, amount, currency);
            }
            else if (path === '/api/billing/subscription' && request.method === 'POST') {
                const { userId, tier } = await request.json();
                response = await billingRouter.createSubscription(userId, tier);
            }
            else if (path.startsWith('/api/billing/webhook/')) {
                response = await billingRouter.handleWebhook(request);
            }
            // Default 404
            else {
                response = new Response(JSON.stringify({ error: 'Not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            // Add CORS headers to response
            Object.entries(corsHeaders).forEach(([key, value]) => {
                response.headers.set(key, value);
            });
            // Add cache headers for GET requests
            if (request.method === 'GET' && response.status === 200) {
                response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
            }
            return response;
        }
        catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    },
    /**
     * Scheduled handler for cron-based task reprocessing
     * Runs every 5 minutes to retry failed tasks
     */
    async scheduled(event, env) {
        try {
            console.log('Cron triggered:', new Date(event.scheduledTime).toISOString());
            const failedTaskQueue = new FailedTaskQueue(env.DB);
            const openClawAPI = new OpenClawAPI(env);
            const qEmplois = new QEmploisService(env);
            const zyeute = new ZyeuteContentService(env);
            // Get failed tasks
            const failedTasks = await failedTaskQueue.getFailedTasks(100);
            console.log(`Found ${failedTasks.length} failed tasks to retry`);
            for (const task of failedTasks) {
                try {
                    await failedTaskQueue.markAsProcessing(task.id);
                    // Get task details to determine service
                    const taskDetails = await env.DB
                        .prepare('SELECT service FROM tasks WHERE id = ?')
                        .bind(task.id)
                        .first();
                    if (!taskDetails)
                        continue;
                    // Retry based on service
                    let result;
                    switch (taskDetails.service) {
                        case 'openclaw':
                            result = await openClawAPI.executeTask(task.id);
                            break;
                        case 'q-emplois':
                            result = await qEmplois.executeTask(task.id);
                            break;
                        case 'zyeute':
                            result = await zyeute.executeTask(task.id);
                            break;
                        default:
                            console.log(`Unknown service: ${taskDetails.service}`);
                            continue;
                    }
                    if (result.success) {
                        console.log(`Task ${task.id} retried successfully`);
                    }
                    else {
                        console.log(`Task ${task.id} retry failed: ${result.error}`);
                    }
                }
                catch (error) {
                    console.error(`Error retrying task ${task.id}:`, error);
                }
            }
        }
        catch (error) {
            console.error('Cron handler error:', error);
        }
    }
};
/**
 * Handle user registration with geo-based routing
 */
async function handleUserRegistration(request, env, geoLocation) {
    try {
        const { email } = await request.json();
        if (!email) {
            return new Response(JSON.stringify({ error: 'Email required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        // Determine region based on geo-location
        const region = determineRegion(geoLocation);
        const userId = crypto.randomUUID();
        // Check GDPR compliance requirements
        const gdprRequired = requiresGDPR(region);
        // Insert user into database
        await env.DB
            .prepare('INSERT INTO users (id, email, created_at, region, subscription_tier) VALUES (?, ?, ?, ?, ?)')
            .bind(userId, email, Date.now(), region, 'free')
            .run();
        // Log user creation
        const auditLogger = new AuditLogger(env.AUDIT_LOGS);
        await auditLogger.log({
            event_type: 'user_registered',
            service: 'platform',
            user_id: userId,
            details: { email, region },
            compliance_flags: gdprRequired ? ['GDPR'] : []
        });
        return new Response(JSON.stringify({
            success: true,
            userId,
            region,
            gdprCompliant: gdprRequired
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    catch (error) {
        console.error('User registration error:', error);
        return new Response(JSON.stringify({
            error: 'Registration failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
