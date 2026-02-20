/**
 * HTML credits page for browser visits (vs JSON API for programmatic)
 */

import type { Env } from "../types";

export interface CreditBalance {
  creditBalance: number;
  freeTasksUsed: number;
  freeTasksRemaining: number;
  freeTasksLimit: number;
}

export function serveCreditsPage(
  balance: CreditBalance,
  baseUrl: string,
  userId: string,
  env?: Env
): Response {
  const apiBase = (env?.PUBLIC_API_URL || baseUrl).replace(/\/$/, "");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your credits – Omniclaws</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --brand: #f59e0b; --brand-dark: #1e293b; --brand-accent: #ea580c; --text: #1e293b; --text-muted: #64748b; --bg-muted: #fffbeb; --border: #fde68a; }
    * { box-sizing: border-box; }
    body { font-family: 'DM Sans', system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 48px 24px; line-height: 1.6; color: var(--text); }
    .logo { font-weight: 700; font-size: 1rem; color: var(--brand-dark); margin-bottom: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 600; color: var(--brand-dark); margin-bottom: 1.5rem; }
    .balance { background: var(--bg-muted); padding: 1.5rem; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 1.5rem; }
    .balance-row { display: flex; justify-content: space-between; padding: 0.5rem 0; font-size: 0.9375rem; }
    .balance-row strong { color: var(--text); }
    .balance-row span { color: var(--text-muted); }
    .cta { display: inline-block; background: linear-gradient(135deg, var(--brand) 0%, var(--brand-accent) 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9375rem; margin-top: 0.5rem; }
    .cta:hover { opacity: 0.9; }
    .back { font-size: 0.875rem; margin-top: 1.5rem; }
    .back a { color: var(--brand); text-decoration: none; }
    .back a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="logo">Omniclaws</div>
  <h1>Your credits</h1>
  <div class="balance">
    <div class="balance-row"><strong>Free tasks today</strong><span>${balance.freeTasksRemaining} / ${balance.freeTasksLimit} remaining</span></div>
    <div class="balance-row"><strong>Pro credits</strong><span>${balance.creditBalance}</span></div>
  </div>
  <p style="font-size: 0.875rem; color: var(--text-muted);">Use the API to run tasks. Free tier: 50 tasks/day. Pro: 1 credit per task.</p>
  <a href="${apiBase}/" class="cta">Back to home</a>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
