/**
 * Geo-based routing using Cloudflare cf-ipcountry header
 * Routes EU/UK to Paddle (MoR handles VAT), US/CA to Stripe
 */

import type { BillingRegion } from "../types";

/** EU/UK country codes - route to Paddle for MoR VAT handling */
const PADDLE_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "UK", "XI",
]);

/** US/CA - route to Stripe for usage-based billing */
const STRIPE_COUNTRIES = new Set(["US", "CA"]);

/**
 * Get billing region from request headers (cf-ipcountry set by Cloudflare at edge)
 * @param request - Incoming request with cf-ipcountry header
 * @returns BillingRegion for routing decisions
 */
export function getBillingRegion(request: Request): BillingRegion {
  const country = request.headers.get("cf-ipcountry") ?? "XX";
  const countryUpper = country.toUpperCase();

  if (PADDLE_COUNTRIES.has(countryUpper)) return "EU";
  if (STRIPE_COUNTRIES.has(countryUpper)) return countryUpper as "US" | "CA";
  return "OTHER";
}

/**
 * Check if request originates from EU (for GDPR/data residency)
 */
export function isEURequest(request: Request): boolean {
  return getBillingRegion(request) === "EU";
}
