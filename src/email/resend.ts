import type { Env } from '../types';

/**
 * Resend Email Service
 * Sends transactional emails: welcome, low credits, weekly reports
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

interface EmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}

export class EmailService {
  private apiKey: string;
  private fromDomain: string;
  private env: Env;

  constructor(env: Env) {
    this.apiKey = env.RESEND_API_KEY || '';
    this.fromDomain = env.EMAIL_DOMAIN || 'omniclaws.brandonlacoste9.workers.dev';
    this.env = env;
  }

  private isEnabled(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private getFromEmail(name: string = 'Omniclaws'): string {
    return `${name} <noreply@${this.fromDomain}>`;
  }

  /**
   * Send an email via Resend
   */
  async send(payload: EmailPayload): Promise<{ id?: string; error?: string }> {
    if (!this.isEnabled()) {
      console.log('[Email] Skipping send (no API key):', payload.subject);
      return { error: 'Email service not configured' };
    }

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Email] Send failed:', error);
        return { error };
      }

      const data = await response.json();
      console.log('[Email] Sent:', payload.subject, '→', data.id);
      return { id: data.id };
    } catch (err) {
      console.error('[Email] Send error:', err);
      return { error: String(err) };
    }
  }

  // ===== Pre-built Email Flows =====

  /**
   * Welcome email - sent immediately after signup
   */
  async sendWelcomeEmail(to: string, props: {
    userId: string;
    freeTasks: number;
    signupDate: string;
  }): Promise<{ id?: string; error?: string }> {
    const subject = 'Welcome to Omniclaws - Your 50 free tasks are ready';
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Omniclaws</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .stats { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .cta { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🐝 Welcome to Omniclaws</h1>
    <p>Global automation. Local execution. 24/7 revenue.</p>
  </div>
  <div class="content">
    <p>Hey there,</p>
    <p>Your Omniclaws account is live and ready to claw profit from every timezone.</p>
    
    <div class="stats">
      <h3>🎁 Your Starter Pack</h3>
      <ul>
        <li><strong>${props.freeTasks} free tasks</strong> to test the platform</li>
        <li><strong>$0.05/task</strong> after that (pay-as-you-go)</li>
        <li><strong>200+ edge locations</strong> worldwide</li>
        <li><strong>EU AI Act compliant</strong> by default</li>
      </ul>
    </div>

    <p><strong>What you can build:</strong></p>
    <ul>
      <li>🤖 Automated recruitment (Q-Emplois integration)</li>
      <li>📱 Content arbitrage (Zyeuté scraper)</li>
      <li>🐋 Whale alerts (blockchain monitoring)</li>
      <li>⚡ Custom AI agents (your own logic)</li>
    </ul>

    <a href="https://omniclaws.brandonlacoste9.workers.dev/dashboard" class="cta">Open Dashboard</a>

    <div class="footer">
      <p>Questions? Reply to this email or check the docs.</p>
      <p>Omniclaws • Global edge automation platform</p>
    </div>
  </div>
</body>
</html>`;

    const text = `
Welcome to Omniclaws!

Your account is live with ${props.freeTasks} free tasks ready to use.

What you can build:
- Automated recruitment (Q-Emplois integration)
- Content arbitrage (Zyeuté scraper)
- Whale alerts (blockchain monitoring)
- Custom AI agents

Pricing: $0.05/task after your free credits.

Dashboard: https://omniclaws.brandonlacoste9.workers.dev/dashboard

Questions? Reply to this email.
`;

    return this.send({
      from: this.getFromEmail(),
      to,
      subject,
      html,
      text,
      reply_to: 'bee@omniclaws.io',
    });
  }

  /**
   * Low credits warning - sent when user hits threshold
   */
  async sendLowCreditsEmail(to: string, props: {
    userId: string;
    remaining: number;
    used: number;
    total: number;
  }): Promise<{ id?: string; error?: string }> {
    const subject = `⚡ ${props.remaining} tasks remaining - Top up?`;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .progress { background: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden; margin: 15px 0; }
    .progress-bar { background: #f59e0b; height: 100%; width: ${(props.used / props.total) * 100}%; }
    .cta { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>⚡ Running Low on Credits</h2>
  </div>
  <div class="content">
    <p>You've used <strong>${props.used}</strong> of your <strong>${props.total}</strong> tasks.</p>
    
    <div class="progress">
      <div class="progress-bar"></div>
    </div>
    
    <p><strong>${props.remaining} tasks remaining</strong></p>
    
    <p>Top up now to keep your automations running 24/7:</p>
    
    <ul>
      <li>100 tasks - $5.00</li>
      <li>500 tasks - $20.00 (20% off)</li>
      <li>1000 tasks - $35.00 (30% off)</li>
    </ul>

    <a href="https://omniclaws.brandonlacoste9.workers.dev/billing" class="cta">Buy Credits</a>
  </div>
</body>
</html>`;

    return this.send({
      from: this.getFromEmail(),
      to,
      subject,
      html,
    });
  }

  /**
   * Weekly usage report
   */
  async sendWeeklyReport(to: string, props: {
    userId: string;
    weekStart: string;
    tasksExecuted: number;
    creditsSpent: number;
    topServices: Array<{ service: string; count: number }>;
    remainingCredits: number;
  }): Promise<{ id?: string; error?: string }> {
    const subject = `📊 Your Omniclaws Week: ${props.tasksExecuted} tasks executed`;
    
    const servicesList = props.topServices
      .map(s => `<li>${s.service}: ${s.count} tasks</li>`)
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .stat-box { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; display: inline-block; width: 45%; margin-right: 5%; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>📊 Your Weekly Report</h2>
    <p>Week of ${props.weekStart}</p>
  </div>
  <div class="content">
    <div class="stat-box">
      <h3>${props.tasksExecuted}</h3>
      <p>Tasks Executed</p>
    </div>
    <div class="stat-box">
      <h3>$${props.creditsSpent.toFixed(2)}</h3>
      <p>Credits Spent</p>
    </div>
    
    <h3>Top Services</h3>
    <ul>${servicesList}</ul>
    
    <p><strong>Remaining Credits:</strong> ${props.remainingCredits} tasks</p>
    
    <div class="footer">
      <p>You're running a global automation platform. Nice work.</p>
    </div>
  </div>
</body>
</html>`;

    return this.send({
      from: this.getFromEmail('Omniclaws Weekly'),
      to,
      subject,
      html,
    });
  }
}

// Singleton getter
export function getEmailService(env: Env): EmailService {
  return new EmailService(env);
}
