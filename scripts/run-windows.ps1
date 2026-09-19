$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

if (-not (Test-Path ".env")) {
  throw "Missing .env. Run .\scripts\setup-windows.ps1 first."
}

Write-Host "Starting Maps Scraper at http://localhost:8080"
Write-Host "Keep this PowerShell window open. Windows sleep must be disabled while a scrape is running."
& npm.cmd start
