$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Node.js LTS is required. Install it from https://nodejs.org/, open a new PowerShell window, then run this script again."
  }

  Write-Host "Installing Node.js LTS with winget..."
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  Write-Host "Node.js was installed. Close this PowerShell window, open a new one, and run this script again."
  exit 0
}

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required (found $(& node --version)). Upgrade Node.js, then run this script again."
}

Write-Host "Installing project dependencies and Chromium..."
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

if (-not (Test-Path ".env")) {
  $mapsSetupAdminUser = Read-Host "Admin username"
  $securePassword = Read-Host "Admin password (at least 8 characters)" -AsSecureString
  $credentialPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $mapsSetupAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($credentialPointer)
    $mapsSetupMaxConcurrent = Read-Host "Concurrent scrape jobs [2]"
    if ([string]::IsNullOrWhiteSpace($mapsSetupMaxConcurrent)) { $mapsSetupMaxConcurrent = "2" }

    $env:MAPS_SETUP_ADMIN_USER = $mapsSetupAdminUser
    $env:MAPS_SETUP_ADMIN_PASSWORD = $mapsSetupAdminPassword
    $env:MAPS_SETUP_MAX_CONCURRENT = $mapsSetupMaxConcurrent
    & node scripts/create-local-env.js
    if ($LASTEXITCODE -ne 0) { throw "Could not create .env." }
  }
  finally {
    if ($credentialPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($credentialPointer) }
    Remove-Item Env:MAPS_SETUP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  }
}
else {
  Write-Host ".env already exists; keeping its credentials and settings."
}

Write-Host ""
Write-Host "Setup complete. Run: .\scripts\run-windows.ps1"
