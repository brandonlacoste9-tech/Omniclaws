# API Testing Examples

This document provides examples of how to test the Omniclaws API endpoints using curl.

## Prerequisites

- The worker must be deployed or running locally (`npm run dev`)
- Replace `YOUR_WORKER_URL` with your actual worker URL
- Replace placeholder IDs with actual values from your database

## User Registration

```bash
curl -X POST YOUR_WORKER_URL/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }'
```

Expected response:
```json
{
  "success": true,
  "userId": "uuid-here",
  "region": "US",
  "gdprCompliant": false
}
```

## OpenClaw API

### Create Scraping Task

```bash
curl -X POST YOUR_WORKER_URL/api/openclaw/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "scraping",
    "payload": {
      "url": "https://example.com",
      "selectors": ["h1", "p"]
    }
  }'
```

### Create Form Filling Task

```bash
curl -X POST YOUR_WORKER_URL/api/openclaw/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "form_filling",
    "payload": {
      "url": "https://example.com/contact",
      "fields": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  }'
```

### Create Scheduling Task

```bash
curl -X POST YOUR_WORKER_URL/api/openclaw/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "scheduling",
    "payload": {
      "action": "send_email",
      "schedule": "0 9 * * 1"
    }
  }'
```

### Get Task Status

```bash
curl -X GET "YOUR_WORKER_URL/api/openclaw/tasks?taskId=YOUR_TASK_ID"
```

## Q-Emplois (High-Risk AI)

### Create Candidate Screening Task

```bash
curl -X POST YOUR_WORKER_URL/api/q-emplois/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "candidate_screening",
    "payload": {
      "resume": "Experienced software engineer with 5 years in TypeScript...",
      "requirements": ["TypeScript", "React", "Node.js"]
    }
  }'
```

### Create Job Matching Task

```bash
curl -X POST YOUR_WORKER_URL/api/q-emplois/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "job_matching",
    "payload": {
      "jobDescription": "Senior TypeScript Developer needed...",
      "candidatePool": ["candidate1", "candidate2", "candidate3"]
    }
  }'
```

### Get Pending Human Oversight Items

```bash
curl -X GET YOUR_WORKER_URL/api/q-emplois/oversight
```

### Submit Human Review

```bash
curl -X POST YOUR_WORKER_URL/api/q-emplois/oversight/review \
  -H "Content-Type: application/json" \
  -d '{
    "oversightId": "YOUR_OVERSIGHT_ID",
    "reviewerId": "YOUR_REVIEWER_ID",
    "decision": "approved",
    "reasoning": "Candidate meets all requirements and has relevant experience"
  }'
```

## Zyeuté Content

### Create RSS Scraping Task

```bash
curl -X POST YOUR_WORKER_URL/api/zyeute/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "rss_scrape",
    "payload": {
      "feedUrl": "https://example.com/feed.xml",
      "limit": 10
    }
  }'
```

### Create AI Summarization Task

```bash
curl -X POST YOUR_WORKER_URL/api/zyeute/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "taskType": "ai_summarize",
    "payload": {
      "content": "Long article content here...",
      "maxLength": 200
    }
  }'
```

### Run Full Arbitrage Workflow

```bash
curl -X POST YOUR_WORKER_URL/api/zyeute/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "feedUrl": "https://example.com/feed.xml",
    "affiliateLinks": [
      {
        "keyword": "product",
        "url": "https://affiliate.example.com/ref123"
      },
      {
        "keyword": "service",
        "url": "https://affiliate.example.com/ref456"
      }
    ]
  }'
```

## Billing

### Process One-Time Payment

```bash
curl -X POST YOUR_WORKER_URL/api/billing/payment \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "amount": 10.00,
    "currency": "USD"
  }'
```

### Create Subscription

```bash
curl -X POST YOUR_WORKER_URL/api/billing/subscription \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "tier": "pro"
  }'
```

## Health Check

```bash
curl -X GET YOUR_WORKER_URL/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": 1234567890
}
```

## Testing Locally

If running locally with `npm run dev`, use `http://localhost:8787` as YOUR_WORKER_URL:

```bash
# Example local test
curl -X POST http://localhost:8787/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

## Notes

- All POST requests require `Content-Type: application/json` header
- User IDs and task IDs are UUIDs
- Payment amounts are in decimal format (e.g., 10.00 for $10)
- Currency codes follow ISO 4217 (USD, EUR, GBP, etc.)
- EU/UK users are automatically routed to Paddle
- US/CA users are automatically routed to Stripe
