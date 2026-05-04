# Called by Inno Setup after copying files.
# Reads RTSP URL and API Key from temp files, generates a JWT secret,
# writes backend\.env and backend\data\initial_config.json

param([string]$InstallDir, [string]$BranchName)

# ── Read values written to temp files by Inno Setup Pascal code ───────────────
# (Temp files avoid shell-escaping issues with special characters like @ : / in URLs)

$rtspFile   = Join-Path $env:TEMP "autotrack_rtsp.txt"
$apiKeyFile = Join-Path $env:TEMP "autotrack_apikey.txt"

$rtspUrl = ""
if (Test-Path $rtspFile) {
    $rtspUrl = (Get-Content $rtspFile -Raw -Encoding UTF8).Trim()
    Remove-Item $rtspFile -Force -ErrorAction SilentlyContinue
}

$apiKey = ""
if (Test-Path $apiKeyFile) {
    $apiKey = (Get-Content $apiKeyFile -Raw -Encoding UTF8).Trim()
    Remove-Item $apiKeyFile -Force -ErrorAction SilentlyContinue
}

# ── Generate a cryptographically secure 64-character JWT secret ───────────────
$bytes  = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
$secret = [BitConverter]::ToString($bytes) -replace '-', ''

# ── Create directories ─────────────────────────────────────────────────────────
$backendDir = Join-Path $InstallDir "backend"
$dataDir    = Join-Path $backendDir "data"
New-Item -ItemType Directory -Path $backendDir -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir    -Force | Out-Null

# ── Write backend\.env ────────────────────────────────────────────────────────
$envContent = @"
JWT_SECRET_KEY=$secret

RTSP_URL=$rtspUrl

ALLOWED_ORIGINS=http://localhost,http://localhost:5173,http://localhost:4173
LOG_LEVEL=INFO
IMAGE_RETENTION_DAYS=30

S3_ENDPOINT_URL=https://6aad6ffcea8c29770bf2afafb6cb7209.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=44b785c8c2e1514ffb77336e4260b21f
S3_SECRET_ACCESS_KEY=26702d93588cbcd236d32de3040824107e4adc186e5b195363c06ca711a72623
S3_BUCKET_NAME=autotrack-images
S3_PUBLIC_URL=https://pub-0c5f3e700bce4ecca623010ae3a76e47.r2.dev

SENTRY_DSN=
"@

$envPath = Join-Path $backendDir ".env"
Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host "Written: $envPath"

# ── Write initial_config.json (read by backend on first startup) ──────────────
# This tells the backend which cloud server to connect to automatically.
# The backend reads this once, pre-populates app_config, then deletes the file.
if ($apiKey -ne "") {
    $configContent = @"
{
  "cloud_url":     "http://13.63.172.65/api",
  "cloud_api_key": "$apiKey",
  "branch_name":   "$BranchName"
}
"@
    $configPath = Join-Path $dataDir "initial_config.json"
    Set-Content -Path $configPath -Value $configContent -Encoding UTF8
    Write-Host "Written: $configPath"
    Write-Host "Branch will auto-connect to cloud on first startup."
} else {
    Write-Host "No API key provided — branch sync must be configured manually in the app."
}
