/**
 * Geo-Router: Routes requests based on CF-IPCountry header
 * Uses Cloudflare's edge location data to determine user geography
 */

export type Region = 'EU' | 'UK' | 'US' | 'CA' | 'OTHER';
export type PaymentProvider = 'paddle' | 'stripe' | 'unsupported';

// EU countries list (Article 50 TEU members)
const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
];

/**
 * Determines the region based on country code
 */
export function getRegion(countryCode: string): Region {
  if (EU_COUNTRIES.includes(countryCode)) {
    return 'EU';
  }
  if (countryCode === 'GB') {
    return 'UK';
  }
  if (countryCode === 'US') {
    return 'US';
  }
  if (countryCode === 'CA') {
    return 'CA';
  }
  return 'OTHER';
}

/**
 * Routes to appropriate payment provider based on geography
 * Paddle: EU/UK (Merchant of Record handles VAT)
 * Stripe: US/CA (direct billing)
 */
export function getPaymentProvider(countryCode: string): PaymentProvider {
  const region = getRegion(countryCode);
  
  if (region === 'EU' || region === 'UK') {
    return 'paddle';
  }
  
  if (region === 'US' || region === 'CA') {
    return 'stripe';
  }
  
  return 'unsupported';
}

/**
 * Extracts country code from Cloudflare request
 */
export function getCountryFromRequest(request: Request): string {
  // Cloudflare adds CF-IPCountry header to all requests
  const countryCode = request.headers.get('CF-IPCountry');
  return countryCode || 'XX'; // XX for unknown/testing
}

/**
 * Determines if a country is subject to GDPR
 */
export function isGDPRCountry(countryCode: string): boolean {
  const region = getRegion(countryCode);
  return region === 'EU' || region === 'UK';
}

/**
 * Determines if a country is subject to EU AI Act
 */
export function isEUAIActCountry(countryCode: string): boolean {
  return getRegion(countryCode) === 'EU';
}
