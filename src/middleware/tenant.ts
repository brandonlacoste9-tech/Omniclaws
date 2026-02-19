/**
 * Multi-tenant router: resolve tenant by host, apply pricing
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface Tenant {
  id: string;
  subdomain: string;
  name: string;
  brand_color: string;
  logo_url: string | null;
  headline: string;
  subhead: string;
  pricing_multiplier: number;
  currency: string;
  language: string;
  region: string;
  allowed_features: string;
  stripe_account_id: string | null;
  created_at: string;
}

/** Region param → tenant id (e.g. ?region=india → omniclaws-in) */
const REGION_TO_TENANT: Record<string, string> = {
  us: "omniclaws-us",
  mx: "omniclaws-mx",
  mexico: "omniclaws-mx",
  ca: "omniclaws-ca",
  canada: "omniclaws-ca",
  br: "omniclaws-br",
  brazil: "omniclaws-br",
  ar: "omniclaws-ar",
  argentina: "omniclaws-ar",
  fr: "omniclaws-fr",
  france: "omniclaws-fr",
  de: "omniclaws-de",
  germany: "omniclaws-de",
  uk: "omniclaws-uk",
  eu: "omniclaws-eu",
  in: "omniclaws-in",
  india: "omniclaws-in",
  sg: "omniclaws-sg",
  singapore: "omniclaws-sg",
  jp: "omniclaws-jp",
  japan: "omniclaws-jp",
  ng: "omniclaws-ng",
  nigeria: "omniclaws-ng",
  za: "omniclaws-za",
  southafrica: "omniclaws-za",
};

/**
 * Resolve tenant by ?region= param or request host. Fallback to omniclaws. Enables
 * testing regional pricing without custom domains.
 */
export async function getTenant(
  request: Request,
  db: D1Database
): Promise<Tenant> {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? request.headers.get("Host") ?? "";
  const hostname = host.split(":")[0].toLowerCase();

  // Check for ?region= fallback first (immediate testing without custom domains)
  const regionParam = url.searchParams.get("region")?.toLowerCase();
  if (regionParam) {
    const tenantId =
      REGION_TO_TENANT[regionParam] ?? `omniclaws-${regionParam}`;
    const tenant = await db
      .prepare("SELECT * FROM tenant_configs WHERE id = ?")
      .bind(tenantId)
      .first<Tenant>();
    if (tenant) return tenant;
  }

  // Host-based routing
  const row = await db
    .prepare("SELECT * FROM tenant_configs WHERE subdomain = ?")
    .bind(hostname)
    .first<Tenant>();

  if (row) return row;

  const defaultRow = await db
    .prepare("SELECT * FROM tenant_configs WHERE id = ?")
    .bind("omniclaws")
    .first<Tenant>();

  return defaultRow ?? defaultTenant();
}

function defaultTenant(): Tenant {
  return {
    id: "omniclaws",
    subdomain: "omniclaws.brandonlacoste9.workers.dev",
    name: "Omniclaws",
    brand_color: "#3b82f6",
    logo_url: null,
    headline: "The 24/7 Revenue Claw",
    subhead: "50 free tasks daily",
    pricing_multiplier: 1.0,
    currency: "USD",
    language: "en",
    region: "americas",
    allowed_features: "openclaw,whale,referral",
    stripe_account_id: null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Apply tenant pricing multiplier to base price.
 */
export function applyPricing(priceCents: number, multiplier: number): number {
  return Math.round(priceCents * multiplier);
}

/**
 * Check if tenant allows a feature.
 */
export function tenantAllowsFeature(tenant: Tenant, feature: string): boolean {
  const features = tenant.allowed_features.split(",").map((f) => f.trim());
  return features.includes(feature);
}
