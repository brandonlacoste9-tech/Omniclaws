# Omniclaws API test script
# Usage: .\scripts\test-api.ps1
# NOTE: Do NOT paste this script's output back into PowerShell - run commands only.

$base = "https://omniclaws.brandonlacoste9.workers.dev"

Write-Host "`n=== 1. Free tier execute ===" -ForegroundColor Cyan
$r1 = Invoke-RestMethod -Uri "$base/openclaw/execute" -Method POST -ContentType "application/json" -Body '{"userId":"test-user","payload":{"simple":true}}'
$r1 | ConvertTo-Json | Write-Host

Write-Host "`n=== 2. Check credits ===" -ForegroundColor Cyan
$r2 = Invoke-RestMethod -Uri "$base/openclaw/credits?userId=test-user" -Method GET
$r2 | ConvertTo-Json | Write-Host

Write-Host "`n=== 3. Whale alerts ===" -ForegroundColor Cyan
$r3 = Invoke-RestMethod -Uri "$base/whales/alerts" -Method GET
Write-Host "mode: $($r3.mode)"
Write-Host "alerts count: $($r3.alerts.Count)"

Write-Host "`n=== 4. Health ===" -ForegroundColor Cyan
$r4 = Invoke-RestMethod -Uri "$base/health" -Method GET
$r4 | ConvertTo-Json | Write-Host
