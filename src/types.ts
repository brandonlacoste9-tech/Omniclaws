// Type definitions for Omniclaws Platform

export interface Env {
  // Cloudflare bindings
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
  
  // API Keys (set via environment variables)
  PADDLE_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  NEVERMINED_API_KEY: string;
}

export interface User {
  id: string;
  email: string;
  created_at: number;
  region: 'EU' | 'UK' | 'US' | 'CA' | 'OTHER';
  payment_provider?: 'paddle' | 'stripe';
  subscription_tier: 'free' | 'pro' | 'enterprise';
}

export interface Task {
  id: string;
  user_id: string;
  service: 'openclaw' | 'q-emplois' | 'zyeute';
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: string; // JSON string
  result?: string; // JSON string
  created_at: number;
  started_at?: number;
  completed_at?: number;
  retry_count: number;
  last_error?: string;
}

export interface Usage {
  id: string;
  user_id: string;
  service: string;
  task_id?: string;
  amount: number;
  created_at: number;
}

export interface HumanOversightItem {
  id: string;
  task_id: string;
  service: string;
  decision_type: string;
  confidence: number;
  ai_recommendation: string; // JSON string
  human_decision?: string; // JSON string
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  reviewed_at?: number;
  reviewer_id?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  provider: 'paddle' | 'stripe';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  provider_transaction_id?: string;
  created_at: number;
}

export interface AuditLogEntry {
  timestamp: number;
  event_type: string;
  service: string;
  user_id: string;
  task_id?: string;
  details: Record<string, unknown>;
  compliance_flags: string[];
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
}

export interface GeoLocation {
  country?: string;
  continent?: string;
  region?: string;
}

export interface PaymentProvider {
  name: 'paddle' | 'stripe';
  processPayment(userId: string, amount: number, currency: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  createSubscription(userId: string, tier: string): Promise<{ success: boolean; subscriptionId?: string; error?: string }>;
}

export interface AIDecision {
  confidence: number;
  recommendation: unknown;
  requiresHumanReview: boolean;
  reasoning?: string;
}
