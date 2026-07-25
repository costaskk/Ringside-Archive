[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$TargetPath,

    [Parameter(Mandatory = $false)]
    [string]$SourcePath,

    [switch]$SkipTests
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $candidate = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'A required path was empty.'
    }

    if ([System.IO.Path]::IsPathRooted($candidate)) {
        return [System.IO.Path]::GetFullPath($candidate)
    }

    return [System.IO.Path]::GetFullPath(
        (Join-Path -Path (Get-Location).Path -ChildPath $candidate)
    )
}

function Normalize-DirectoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Resolve-FullPath -Path $Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

$defaultSource = Join-Path -Path $PSScriptRoot -ChildPath '..'
$sourceRoot = if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    Normalize-DirectoryPath -Path $defaultSource
}
else {
    Normalize-DirectoryPath -Path $SourcePath
}
$targetRoot = Normalize-DirectoryPath -Path $TargetPath

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Source package does not exist: $sourceRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'package.json') -PathType Leaf)) {
    throw "The source folder does not look like the extracted Ringside Archive package: $sourceRoot"
}
if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
    throw "Target repository does not exist: $targetRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $targetRoot '.git') -PathType Container)) {
    Write-Warning "No .git directory was found in the target. Verify that this is your existing repository: $targetRoot"
}
if ([string]::Equals($sourceRoot, $targetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw @"
Source and target are the same directory:
  $targetRoot

Extract the v5.8.1 ZIP to a separate folder, then run this script with:
  -SourcePath <extracted-v5.8.1-folder>
  -TargetPath <existing-repository-folder>
"@
}

$backupRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("ringside-v581-preserve-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$preserve = @(
    'data\artwork-catalog.json',
    'data\artwork-r2-manifest.json'
)

try {
    Write-Host "Source: $sourceRoot" -ForegroundColor Cyan
    Write-Host "Target: $targetRoot" -ForegroundColor Cyan
    Write-Host 'Backing up the target artwork catalogue and R2 manifest...' -ForegroundColor Cyan

    foreach ($relative in $preserve) {
        $existing = Join-Path -Path $targetRoot -ChildPath $relative
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            $info = Get-Item -LiteralPath $existing
            if ($info.Length -gt 2) {
                $destination = Join-Path -Path $backupRoot -ChildPath $relative
                New-Item -ItemType Directory -Path (Split-Path -Path $destination -Parent) -Force | Out-Null
                Copy-Item -LiteralPath $existing -Destination $destination -Force
                Write-Host "  Preserved $relative ($($info.Length) bytes)"
            }
        }
    }

    Write-Host 'Copying v5.8.1 over the existing repository...' -ForegroundColor Cyan
    $robocopyArgs = @(
        $sourceRoot,
        $targetRoot,
        '/E',
        '/COPY:DAT',
        '/DCOPY:DAT',
        '/R:2',
        '/W:1',
        '/NP',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/XD', '.git', 'node_modules', 'public-artwork',
        '/XF', '.env', '.env.local', '.env.production', '.env.development', 'artwork-catalog.r2-staged.json'
    )

    & robocopy @robocopyArgs | Out-Host
    $copyCode = $LASTEXITCODE
    if ($copyCode -gt 7) {
        throw "Robocopy failed with exit code $copyCode."
    }

    Write-Host 'Restoring the preserved R2-generated files...' -ForegroundColor Cyan
    foreach ($relative in $preserve) {
        $saved = Join-Path -Path $backupRoot -ChildPath $relative
        if (Test-Path -LiteralPath $saved -PathType Leaf) {
            $destination = Join-Path -Path $targetRoot -ChildPath $relative
            New-Item -ItemType Directory -Path (Split-Path -Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $saved -Destination $destination -Force
            Write-Host "  Restored $relative"
        }
    }

    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source

    Push-Location $targetRoot
    try {
        Write-Host 'Rebuilding data/core.json...' -ForegroundColor Cyan
        & $npm run build:core
        if ($LASTEXITCODE -ne 0) {
            throw 'npm run build:core failed.'
        }

        if (-not $SkipTests) {
            Write-Host 'Running the complete validation suite...' -ForegroundColor Cyan
            & $npm test
            if ($LASTEXITCODE -ne 0) {
                throw 'npm test failed.'
            }
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host 'Upgrade completed successfully.' -ForegroundColor Green
    Write-Host 'Review and publish it with:' -ForegroundColor Green
    Write-Host "  Set-Location `"$targetRoot`""
    Write-Host '  git add -A'
    Write-Host '  git status'
    Write-Host '  git commit -m "Upgrade Ringside Archive to v5.8.1"'
    Write-Host '  git push'
}
finally {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
}
