/**
 * Dynamic landing page per tenant
 */

import type { Tenant } from "../middleware/tenant";
import type { Env } from "../types";
import { attributionCookieHeader } from "../marketing/attribution";

export function serveLanding(tenant: Tenant, baseUrl: string, ref?: string | null, env?: Env): Response {
  const pricePerTask = (1.0 * tenant.pricing_multiplier).toFixed(2);
  const starterPrice = (5 * tenant.pricing_multiplier).toFixed(2);

  const apiBase = (env?.PUBLIC_API_URL || baseUrl).replace(/\/$/, "");
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const creditsUrl = `${apiBase}/openclaw/credits?userId=demo${refParam}`;
  const executeUrl = ref ? `${apiBase}/openclaw/execute?ref=${encodeURIComponent(ref)}` : `${apiBase}/openclaw/execute`;

  const redditPixelId = env?.REDDIT_PIXEL_ID;
  const metaPixelId = env?.META_PIXEL_ID;
  const twitterPixelId = env?.TWITTER_PIXEL_ID;
  const googleAdsId = env?.GOOGLE_ADS_ID;

  const trackingScripts = [
    redditPixelId && `<!-- Reddit Pixel --><script>!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init','${escapeHtml(redditPixelId)}');rdt('track','PageVisit');</script>`,
    metaPixelId && `<!-- Meta Pixel --><script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${escapeHtml(metaPixelId)}');fbq('track','PageView');</script>`,
    twitterPixelId && `<!-- Twitter Pixel --><script>!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','${escapeHtml(twitterPixelId)}');</script>`,
    googleAdsId && `<!-- Google Ads --><script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(googleAdsId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${escapeHtml(googleAdsId)}');</script>`,
  ].filter(Boolean).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tenant.name)}</title>
  <meta name="description" content="Run AI tasks at the edge. 50 free tasks per day. Pay only when you scale. Secure, fast, developer-first.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet">
  ${trackingScripts}
  <style>
    :root { --brand: ${tenant.brand_color}; --brand-accent: #3b82f6; --text: #1e293b; --text-muted: #64748b; --bg-muted: #f8fafc; --border: #e2e8f0; }
    * { box-sizing: border-box; }
    body { font-family: 'DM Sans', system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 48px 24px 64px; line-height: 1.6; color: var(--text); }
    .logo { font-weight: 700; font-size: 1rem; letter-spacing: -0.02em; color: var(--brand); margin-bottom: 2.5rem; }
    h1 { font-size: 1.75rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; margin-bottom: 0.75rem; color: var(--brand); }
    .subhead { color: var(--text-muted); font-size: 1rem; margin-bottom: 2rem; }
    .features { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; font-size: 0.875rem; color: var(--text-muted); }
    .features span { display: flex; align-items: center; gap: 0.35rem; }
    .features span::before { content: "✓"; color: #22c55e; font-weight: 600; }
    .pricing { background: var(--bg-muted); padding: 1.25rem 1.5rem; border-radius: 10px; margin-bottom: 1.5rem; font-size: 0.9375rem; border: 1px solid var(--border); }
    .pricing strong { color: var(--text); }
    .cta { display: inline-block; background: var(--brand); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9375rem; transition: opacity 0.15s; }
    .cta:hover { opacity: 0.9; }
    .cta-note { font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.75rem; }
    .api { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); font-size: 0.8125rem; color: var(--text-muted); }
    .api summary { cursor: pointer; font-weight: 500; color: var(--text); }
    .api code { display: block; background: var(--bg-muted); padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.75rem; margin-top: 0.5rem; overflow-x: auto; border: 1px solid var(--border); }
    footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); font-size: 0.8125rem; color: var(--text-muted); }
    footer a { color: var(--brand-accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
    .trust { margin-top: 1rem; font-size: 0.75rem; color: var(--text-muted); opacity: 0.9; }
  </style>
</head>
<body>
  <div class="logo">${escapeHtml(tenant.name)}</div>
  <h1>${escapeHtml(tenant.headline)}</h1>
  <p class="subhead">${escapeHtml(tenant.subhead)}</p>
  <div class="features">
    <span>50 free tasks daily</span>
    <span>No credit card for free tier</span>
    <span>Secure payments via Stripe</span>
    <span>Runs on Cloudflare edge</span>
  </div>
  <div class="pricing">
    <strong>Pricing</strong> · $${pricePerTask} per task · Starter pack: $${starterPrice} (5 credits)
  </div>
  <a href="${creditsUrl}" class="cta">Get started free</a>
  <p class="cta-note">No credit card required. Upgrade when you need more.</p>
  <details class="api">
    <summary>API endpoints</summary>
    <code>POST ${executeUrl}</code>
    <code style="margin-top: 0.25rem;">GET ${apiBase}/openclaw/credits</code>
  </details>
  <footer>
    <p><a href="mailto:${escapeHtml(tenant.support_email || "info@adgenxai.pro")}">${escapeHtml(tenant.support_email || "info@adgenxai.pro")}</a> · <a href="mailto:${escapeHtml(tenant.support_email || "info@adgenxai.pro")}?subject=Agency%20plan">Contact sales</a></p>
    <p class="trust">Built on Cloudflare Workers. Payments processed by Stripe.</p>
  </footer>
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
