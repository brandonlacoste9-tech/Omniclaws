/**
 * Geo-Router: Routes requests based on Cloudflare's CF-IPCountry header
 * Determines billing provider and data residency requirements
 */

export interface GeoLocation {
  country: string;
  continent: string;
  region: string;
  billingProvider: 'paddle' | 'stripe';
  isEU: boolean;
}

// EU and UK countries that use Paddle (Merchant of Record)
const PADDLE_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', // UK
]);

// US and Canada use Stripe
const STRIPE_COUNTRIES = new Set(['US', 'CA']);

// EU countries for GDPR compliance
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Extracts and analyzes geo-location from Cloudflare request
 */
export function getGeoLocation(request: Request): GeoLocation {
  const country = request.headers.get('CF-IPCountry') || 'US';
  const continent = request.cf?.continent as string || 'NA';
  const region = request.cf?.region as string || '';
  
  const isEU = EU_COUNTRIES.has(country);
  
  let billingProvider: 'paddle' | 'stripe';
  if (PADDLE_COUNTRIES.has(country)) {
    billingProvider = 'paddle';
  } else if (STRIPE_COUNTRIES.has(country)) {
    billingProvider = 'stripe';
  } else {
    // Default to Stripe for other countries
    billingProvider = 'stripe';
  }
  
  return {
    country,
    continent,
    region,
    billingProvider,
    isEU,
  };
}

/**
 * Validates if a request is from a supported billing region
 */
export function isSupportedRegion(geo: GeoLocation): boolean {
  return PADDLE_COUNTRIES.has(geo.country) || STRIPE_COUNTRIES.has(geo.country);
}

/**
 * Gets the appropriate billing provider for a country code
 */
export function getBillingProvider(countryCode: string): 'paddle' | 'stripe' {
  if (PADDLE_COUNTRIES.has(countryCode)) {
    return 'paddle';
  }
  return 'stripe';
}
