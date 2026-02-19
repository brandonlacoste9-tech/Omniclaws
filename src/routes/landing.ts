/**
 * Dynamic landing page per tenant
 */

import type { Tenant } from "../middleware/tenant";
import { attributionCookieHeader } from "../marketing/attribution";

export function serveLanding(tenant: Tenant, baseUrl: string, ref?: string | null): Response {
  const pricePerTask = (1.0 * tenant.pricing_multiplier).toFixed(2);
  const starterPrice = (5 * tenant.pricing_multiplier).toFixed(2);

  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const creditsUrl = `${baseUrl}/openclaw/credits?userId=demo${refParam}`;
  const executeUrl = ref ? `${baseUrl}/openclaw/execute?ref=${encodeURIComponent(ref)}` : `${baseUrl}/openclaw/execute`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tenant.name)}</title>
  <style>
    :root { --brand: ${tenant.brand_color}; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 0 auto; padding: 48px 24px; line-height: 1.6; color: #1a1a1a; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subhead { color: #666; font-size: 1.125rem; margin-bottom: 2rem; }
    .pricing { background: #f8fafc; padding: 1rem 1.5rem; border-radius: 8px; margin: 1.5rem 0; font-size: 0.95rem; }
    .cta { display: inline-block; background: var(--brand); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1rem; }
    .cta:hover { opacity: 0.95; }
    .api { font-size: 0.875rem; color: #64748b; margin-top: 2rem; }
    .api code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(tenant.headline)}</h1>
  <p class="subhead">${escapeHtml(tenant.subhead)}</p>
  <div class="pricing">
    <strong>Pricing:</strong> $${pricePerTask}/task &middot; Starter pack: $${starterPrice} (5 credits)
  </div>
  <a href="${creditsUrl}" class="cta">Start Free (50 tasks/day)</a>
  <p class="api">API: <code>POST ${executeUrl}</code> &middot; <code>GET ${baseUrl}/openclaw/credits</code></p>
</body>
</html>`;

  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
  if (ref) {
    headers["Set-Cookie"] = attributionCookieHeader(ref);
  }

  return new Response(html, { headers });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
