// Zyeuté Content - Automated content arbitrage bot
import type { Env, Task } from '../types';
import { CircuitBreaker, retryWithBackoff } from '../utils/failover';
import { AuditLogger } from '../compliance/audit-logger';

/**
 * Zyeuté Content - Automated content arbitrage bot
 * Scrapes RSS feeds, summarizes with AI, and injects affiliate links
 */
export class ZyeuteContentService {
  private db: D1Database;
  private auditLogger: AuditLogger;
  private circuitBreaker: CircuitBreaker;

  constructor(env: Env) {
    this.db = env.DB;
    this.auditLogger = new AuditLogger(env.AUDIT_LOGS);
    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  /**
   * Create a content arbitrage task
   */
  async createContentTask(
    userId: string,
    taskType: 'rss_scrape' | 'ai_summarize' | 'affiliate_inject',
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
          'zyeute',
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
        service: 'zyeute',
        user_id: userId,
        task_id: taskId,
        details: { task_type: taskType },
        compliance_flags: []
      });

      return new Response(
        JSON.stringify({
          success: true,
          taskId,
          status: 'pending'
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Zyeuté task creation error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to create content task',
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
   * Execute content arbitrage task
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
        service: 'zyeute',
        user_id: task.user_id,
        task_id: taskId,
        details: { task_type: task.task_type },
        compliance_flags: []
      });

      return { success: true, result };
    } catch (error) {
      console.error('Zyeuté execution error:', error);

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
      case 'rss_scrape':
        return await this.scrapeRSS(payload);
      case 'ai_summarize':
        return await this.summarizeContent(payload);
      case 'affiliate_inject':
        return await this.injectAffiliateLinks(payload);
      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }

  /**
   * Scrape RSS feed
   */
  private async scrapeRSS(payload: { feedUrl: string; limit?: number }): Promise<unknown> {
    try {
      const response = await fetch(payload.feedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      
      // Simple RSS parsing (in production, use a proper XML parser)
      const items = this.parseRSSItems(xml, payload.limit || 10);

      return {
        success: true,
        feedUrl: payload.feedUrl,
        itemCount: items.length,
        items,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`RSS scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse RSS items (simplified implementation)
   */
  private parseRSSItems(xml: string, limit: number): Array<{ title: string; link: string; description: string }> {
    const items: Array<{ title: string; link: string; description: string }> = [];
    
    // Very basic regex-based parsing (use proper XML parser in production)
    const itemRegex = /<item>(.*?)<\/item>/gs;
    const matches = xml.matchAll(itemRegex);
    
    let count = 0;
    for (const match of matches) {
      if (count >= limit) break;
      
      const itemXml = match[1];
      const title = this.extractTag(itemXml, 'title');
      const link = this.extractTag(itemXml, 'link');
      const description = this.extractTag(itemXml, 'description');
      
      if (title && link) {
        items.push({ title, link, description: description || '' });
        count++;
      }
    }
    
    return items;
  }

  /**
   * Extract XML tag content
   */
  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Summarize content with AI (mock implementation)
   */
  private async summarizeContent(payload: { content: string; maxLength?: number }): Promise<unknown> {
    // Mock AI summarization - in production, this would call an actual AI model
    const maxLength = payload.maxLength || 200;
    const words = payload.content.split(' ');
    const summary = words.slice(0, Math.min(words.length, maxLength / 5)).join(' ');

    return {
      success: true,
      originalLength: payload.content.length,
      summaryLength: summary.length,
      summary: summary + '...',
      timestamp: Date.now()
    };
  }

  /**
   * Inject affiliate links into content
   */
  private async injectAffiliateLinks(payload: { 
    content: string; 
    affiliateLinks: Array<{ keyword: string; url: string }> 
  }): Promise<unknown> {
    let modifiedContent = payload.content;
    let injectedCount = 0;

    // Inject affiliate links for matching keywords
    for (const { keyword, url } of payload.affiliateLinks) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      if (regex.test(modifiedContent)) {
        modifiedContent = modifiedContent.replace(
          regex,
          `<a href="${url}" rel="nofollow sponsored">${keyword}</a>`
        );
        injectedCount++;
      }
    }

    return {
      success: true,
      originalContent: payload.content,
      modifiedContent,
      linksInjected: injectedCount,
      timestamp: Date.now()
    };
  }

  /**
   * Process full content arbitrage workflow
   */
  async processArbitrageWorkflow(
    userId: string,
    feedUrl: string,
    affiliateLinks: Array<{ keyword: string; url: string }>
  ): Promise<Response> {
    try {
      // Step 1: Scrape RSS
      const scrapeTask = await this.createContentTask(userId, 'rss_scrape', { feedUrl });
      const scrapeResult = await scrapeTask.json() as { taskId: string };
      const scraped = await this.executeTask(scrapeResult.taskId);

      if (!scraped.success || !scraped.result) {
        throw new Error('RSS scraping failed');
      }

      const items = (scraped.result as { items: Array<{ title: string; description: string }> }).items;
      const processedItems = [];

      // Step 2: Process each item
      for (const item of items) {
        // Summarize
        const summarizeTask = await this.createContentTask(userId, 'ai_summarize', {
          content: item.description
        });
        const summarizeResult = await summarizeTask.json() as { taskId: string };
        const summarized = await this.executeTask(summarizeResult.taskId);

        // Inject affiliate links
        if (summarized.success && summarized.result) {
          const summary = (summarized.result as { summary: string }).summary;
          const injectTask = await this.createContentTask(userId, 'affiliate_inject', {
            content: summary,
            affiliateLinks
          });
          const injectResult = await injectTask.json() as { taskId: string };
          const injected = await this.executeTask(injectResult.taskId);

          if (injected.success && injected.result) {
            processedItems.push({
              title: item.title,
              content: (injected.result as { modifiedContent: string }).modifiedContent
            });
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          processedCount: processedItems.length,
          items: processedItems
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Arbitrage workflow failed',
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
