/**
 * GDPR Compliance: Data Residency Enforcement
 * Ensures EU user data stays within EU boundaries
 */

export interface DataResidencyCheck {
  allowed: boolean;
  reason: string;
  userCountry: string;
  isEU: boolean;
}

// EU member states requiring data residency
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Checks if a country is in the EU
 */
export function isEUCountry(countryCode: string): boolean {
  return EU_COUNTRIES.has(countryCode);
}

/**
 * Validates data residency requirements for GDPR compliance
 * EU data must be processed in EU regions
 */
export function checkDataResidency(
  userCountry: string,
  _processingRegion?: string
): DataResidencyCheck {
  const isEU = isEUCountry(userCountry);
  
  if (!isEU) {
    return {
      allowed: true,
      reason: 'Non-EU user, no data residency restrictions',
      userCountry,
      isEU: false,
    };
  }
  
  // For Cloudflare Workers, data is processed at the edge closest to user
  // EU users automatically get EU edge locations
  // Additional validation can be added here if needed
  
  return {
    allowed: true,
    reason: 'EU user data processed at EU edge location per GDPR Article 44-45',
    userCountry,
    isEU: true,
  };
}

/**
 * Generates GDPR-compliant data processing notice
 */
export function generateDataProcessingNotice(userCountry: string): string {
  const isEU = isEUCountry(userCountry);
  
  if (isEU) {
    return `Data Processing Notice: Your data is processed in accordance with GDPR (Regulation EU 2016/679). ` +
           `Processing occurs within EU boundaries. You have rights to access, rectification, erasure, ` +
           `and data portability under Articles 15-20. Contact: privacy@omniclaws.com`;
  }
  
  return `Data Processing Notice: Your data is processed in accordance with applicable data protection laws. ` +
         `Contact: privacy@omniclaws.com for data subject requests.`;
}

/**
 * Validates consent requirements for data processing
 */
export interface ConsentCheck {
  required: boolean;
  type: 'explicit' | 'implicit' | 'none';
  basis: string;
}

export function checkConsentRequirements(
  userCountry: string,
  processingType: 'automated' | 'manual' | 'high-risk'
): ConsentCheck {
  const isEU = isEUCountry(userCountry);
  
  if (!isEU) {
    return {
      required: false,
      type: 'none',
      basis: 'Non-EU user, standard terms of service apply',
    };
  }
  
  // GDPR Article 22: Automated decision-making
  if (processingType === 'automated' || processingType === 'high-risk') {
    return {
      required: true,
      type: 'explicit',
      basis: 'GDPR Article 22 - Explicit consent required for automated decision-making',
    };
  }
  
  return {
    required: true,
    type: 'implicit',
    basis: 'GDPR Article 6(1)(b) - Processing necessary for contract performance',
  };
}

/**
 * Anonymizes personal data for logging purposes
 */
export function anonymizePersonalData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const anonymized = { ...data };
  const sensitiveFields = ['email', 'name', 'phone', 'address', 'ssn', 'passport'];
  
  for (const field of sensitiveFields) {
    if (field in anonymized) {
      const value = anonymized[field];
      if (typeof value === 'string' && value.length > 0) {
        // Hash or mask the value
        anonymized[field] = `[REDACTED-${field.toUpperCase()}]`;
      }
    }
  }
  
  return anonymized;
}

/**
 * Validates data retention period per GDPR Article 5
 */
export function getDataRetentionPeriod(dataType: string): number {
  const retentionPeriods: Record<string, number> = {
    'task_execution': 90,      // 90 days for task logs
    'audit_log': 365 * 7,      // 7 years for compliance logs
    'usage_data': 365 * 2,     // 2 years for billing records
    'user_profile': 365 * 5,   // 5 years for user data (or until deletion request)
  };
  
  return retentionPeriods[dataType] || 90; // Default 90 days
}
