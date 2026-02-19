/**
 * Example Usage and Integration Tests for Omniclaws Platform
 * This file demonstrates how to interact with the platform
 */

import type { Env } from './index';

// Example: Creating a user
export async function createTestUser(env: Env): Promise<string> {
  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();
  
  await env.DB
    .prepare(
      `INSERT INTO users (id, email, country_code, billing_provider, api_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      'test@example.com',
      'US',
      'stripe',
      apiKey,
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000)
    )
    .run();
  
  console.log('Created test user:', { userId, apiKey });
  return apiKey;
}

// Example: Execute a simple task
export async function exampleOpenClawTask(apiKey: string, workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/task`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service: 'openclaw-api',
      input: {
        type: 'computation',
        parameters: {
          operation: 'sum',
          values: [10, 20, 30, 40, 50],
        },
      },
    }),
  });
  
  const result = await response.json();
  console.log('Task result:', result);
}

// Example: Execute recruitment AI task (high-risk)
export async function exampleRecruitmentTask(apiKey: string, workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/task`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'cf-ipcountry': 'FR', // Simulate EU user
    },
    body: JSON.stringify({
      service: 'q-emplois',
      input: {
        candidate: {
          name: 'Jean Dupont',
          email: 'jean@example.fr',
          resume: 'Experienced software developer with 5+ years of experience in full-stack development...',
          skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python'],
          experience_years: 5,
          education: 'master',
          location: 'Paris, France',
        },
        job: {
          title: 'Senior Full-Stack Developer',
          required_skills: ['JavaScript', 'React', 'Node.js'],
          min_experience_years: 3,
          education_level: 'bachelor',
        },
      },
    }),
  });
  
  const result = await response.json() as any;
  console.log('Recruitment screening result:', result);
  
  // Check if human review is required
  if (result.result?.complianceCheck?.requiresHumanReview) {
    console.log('⚠️ Human review required due to EU AI Act compliance');
  }
}

// Example: Execute content arbitrage task
export async function exampleContentArbitrage(apiKey: string, workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/task`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service: 'zyeute-content',
      input: {
        sources: [
          {
            url: 'https://example.com/tech-news',
            type: 'article',
            keywords: ['ai', 'technology', 'innovation'],
          },
        ],
        targets: [
          {
            platform: 'twitter',
            accountId: 'my_twitter_account',
          },
        ],
        filters: {
          minQuality: 0.7,
          maxAge: 24,
          excludeKeywords: ['politics', 'controversial'],
        },
      },
    }),
  });
  
  const result = await response.json();
  console.log('Content arbitrage result:', result);
}

// Example: Get task status
export async function getTaskStatus(taskId: string, workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/task/${taskId}`, {
    method: 'GET',
  });
  
  const result = await response.json();
  console.log('Task status:', result);
}

// Example: Get billing summary
export async function getBillingSummary(apiKey: string, workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/billing/summary`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });
  
  const result = await response.json();
  console.log('Billing summary:', result);
}

// Example: Get pending human reviews
export async function getPendingReviews(workerUrl: string): Promise<void> {
  const response = await fetch(`${workerUrl}/api/reviews/pending`, {
    method: 'GET',
  });
  
  const result = await response.json();
  console.log('Pending human reviews:', result);
}

// Test geo-routing
export async function testGeoRouting(): Promise<void> {
  console.log('\n=== Testing Geo-Routing ===');
  
  const { getGeoLocation } = await import('./utils/geo-router');
  
  // Simulate requests from different countries
  const countries = ['US', 'GB', 'FR', 'DE', 'CA'];
  
  for (const country of countries) {
    const mockRequest = new Request('https://example.com', {
      headers: { 'cf-ipcountry': country },
    });
    
    const geo = getGeoLocation(mockRequest);
    console.log(`${country}: Billing provider = ${geo.billingProvider}, EU = ${geo.isEU}`);
  }
}

// Test failover and retry logic
export async function testFailover(): Promise<void> {
  console.log('\n=== Testing Failover Logic ===');
  
  const { CircuitBreaker, calculateBackoff } = await import('./utils/failover');
  
  // Test exponential backoff calculation
  for (let i = 0; i < 5; i++) {
    const delay = calculateBackoff(i);
    console.log(`Retry ${i}: ${delay}ms delay`);
  }
  
  // Test circuit breaker
  const breaker = new CircuitBreaker();
  console.log(`Circuit breaker initial state: ${breaker.getState()}`);
  
  // Simulate failures
  for (let i = 0; i < 6; i++) {
    breaker.recordFailure();
    console.log(`After ${i + 1} failures: ${breaker.getState()}`);
  }
}

// Test EU AI Act compliance
export async function testEUAIAct(): Promise<void> {
  console.log('\n=== Testing EU AI Act Compliance ===');
  
  const { isHighRiskService, performRiskAssessment } = await import('./compliance/eu-ai-act');
  
  const services = ['openclaw-api', 'q-emplois', 'zyeute-content'];
  
  for (const service of services) {
    const isHighRisk = isHighRiskService(service);
    console.log(`${service}: High-risk = ${isHighRisk}`);
    
    if (isHighRisk) {
      const assessment = await performRiskAssessment('test-task', service, {}, 0.92);
      console.log(`  - Confidence: ${assessment.confidence}`);
      console.log(`  - Requires human review: ${assessment.requiresHumanReview}`);
      console.log(`  - Rationale: ${assessment.decisionRationale}`);
    }
  }
}

// Test GDPR compliance
export async function testGDPR(): Promise<void> {
  console.log('\n=== Testing GDPR Compliance ===');
  
  const { isEUCountry, checkDataResidency, checkConsentRequirements } = await import('./compliance/gdpr');
  
  const countries = ['US', 'FR', 'DE', 'GB', 'CA'];
  
  for (const country of countries) {
    const isEU = isEUCountry(country);
    const residency = checkDataResidency(country);
    const consent = checkConsentRequirements(country, 'high-risk');
    
    console.log(`${country}:`);
    console.log(`  - EU country: ${isEU}`);
    console.log(`  - Data residency allowed: ${residency.allowed}`);
    console.log(`  - Consent required: ${consent.required} (${consent.type})`);
  }
}

// Main test runner
export async function runAllTests(env: Env, workerUrl: string): Promise<void> {
  console.log('🚀 Omniclaws Platform - Test Suite\n');
  
  try {
    // Unit tests
    await testGeoRouting();
    await testFailover();
    await testEUAIAct();
    await testGDPR();
    
    // Integration tests (requires deployed worker)
    console.log('\n=== Integration Tests ===');
    console.log('Creating test user...');
    const apiKey = await createTestUser(env);
    
    console.log('\nTesting OpenClaw API...');
    await exampleOpenClawTask(apiKey, workerUrl);
    
    console.log('\nTesting Recruitment AI (high-risk)...');
    await exampleRecruitmentTask(apiKey, workerUrl);
    
    console.log('\nTesting Content Arbitrage...');
    await exampleContentArbitrage(apiKey, workerUrl);
    
    console.log('\nGetting billing summary...');
    await getBillingSummary(apiKey, workerUrl);
    
    console.log('\nGetting pending reviews...');
    await getPendingReviews(workerUrl);
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}
