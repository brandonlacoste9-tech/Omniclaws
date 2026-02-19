// Geo-router utility for determining payment provider based on user location
import type { GeoLocation } from '../types';

/**
 * Determines the appropriate region based on geo-location
 * EU/UK -> Paddle (Merchant of Record for VAT)
 * US/CA -> Stripe (usage-based metering)
 * Other -> Stripe (default)
 */
export function determineRegion(geo: GeoLocation): 'EU' | 'UK' | 'US' | 'CA' | 'OTHER' {
  if (!geo.country) {
    return 'OTHER';
  }

  const country = geo.country.toUpperCase();

  // UK
  if (country === 'GB' || country === 'UK') {
    return 'UK';
  }

  // EU countries
  const euCountries = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
  ];
  if (euCountries.includes(country)) {
    return 'EU';
  }

  // North America
  if (country === 'US') {
    return 'US';
  }
  if (country === 'CA') {
    return 'CA';
  }

  return 'OTHER';
}

/**
 * Determines the payment provider based on region
 */
export function getPaymentProvider(region: 'EU' | 'UK' | 'US' | 'CA' | 'OTHER'): 'paddle' | 'stripe' {
  if (region === 'EU' || region === 'UK') {
    return 'paddle';
  }
  return 'stripe';
}

/**
 * Checks if the region requires GDPR compliance
 */
export function requiresGDPR(region: 'EU' | 'UK' | 'US' | 'CA' | 'OTHER'): boolean {
  return region === 'EU' || region === 'UK';
}

/**
 * Determines data residency requirements
 */
export function getDataResidency(region: 'EU' | 'UK' | 'US' | 'CA' | 'OTHER'): 'EU' | 'US' | 'GLOBAL' {
  if (region === 'EU' || region === 'UK') {
    return 'EU';
  }
  if (region === 'US' || region === 'CA') {
    return 'US';
  }
  return 'GLOBAL';
}
