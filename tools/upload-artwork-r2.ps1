param(
    [Parameter(Mandatory=$true)][string]$AccountId,
    [Parameter(Mandatory=$true)][string]$BucketName,
    [Parameter(Mandatory=$true)][string]$PublicBaseUrl,
    [string]$SourceDir = ".\public-artwork",
    [string]$StagedCatalog = ".\data\artwork-catalog.r2-staged.json",
    [string]$EndpointUrl = "",
    [switch]$KeepRemoteFiles
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required. Install it from https://aws.amazon.com/cli/ and reopen PowerShell."
}
if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
    throw "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to the bucket-scoped Cloudflare R2 credentials first."
}
if (-not $EndpointUrl) { $EndpointUrl = "https://$AccountId.r2.cloudflarestorage.com" }

Write-Host "Preparing accepted artwork for Cloudflare R2..." -ForegroundColor Cyan
node .\scripts\cache-artwork-assets.mjs "--public-base-url=$PublicBaseUrl"
if ($LASTEXITCODE -ne 0) { throw "Artwork preparation failed." }

$syncArgs = @(
    "s3", "sync", $SourceDir, "s3://$BucketName",
    "--endpoint-url", $EndpointUrl,
    "--cache-control", "public,max-age=31536000,immutable",
    "--no-progress"
)
# Preserve runtime artwork uploaded by authenticated in-app scans.

Write-Host "Uploading artwork objects to R2..." -ForegroundColor Cyan
& aws @syncArgs
if ($LASTEXITCODE -ne 0) { throw "R2 upload failed. The live artwork catalogue was not replaced." }

if (-not (Test-Path $StagedCatalog)) { throw "Staged artwork catalogue not found: $StagedCatalog" }
Copy-Item $StagedCatalog ".\data\artwork-catalog.json" -Force
Remove-Item $StagedCatalog -Force

Write-Host "Rebuilding the startup catalogue and validating the project..." -ForegroundColor Cyan
npm run build:core
npm test
if ($LASTEXITCODE -ne 0) { throw "Validation failed after the R2 catalogue update." }

Write-Host "Cloudflare R2 artwork publication completed." -ForegroundColor Green
Write-Host "Commit data/artwork-catalog.json and data/artwork-r2-manifest.json to GitHub."

