<#
.SYNOPSIS
  Create a deploy zip containing only Docker-required files.

.DESCRIPTION
  This script creates a deployment package for Docker deployment.
  Use -Dockerfile parameter to choose between Alpine (default) or Debian base image.

.PARAMETER OutZip
  Output zip file name (optional, auto-generated if not specified)

.PARAMETER Dockerfile
  Dockerfile to use: "Dockerfile" (Alpine, default) or "Dockerfile.debian" (Debian)

.EXAMPLE
  .\create_deploy_zip.ps1

.EXAMPLE
  .\create_deploy_zip.ps1 -Dockerfile "Dockerfile.debian"
#>
param(
  [string]$OutZip = "",
  [string]$Dockerfile = "Dockerfile"  # Options: "Dockerfile" (Alpine) or "Dockerfile.debian" (Debian)
)

$Root = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
if (-not $OutZip -or $OutZip -eq "") {
  $timestamp = (Get-Date -Format "yyyyMMdd-HHmmss")
  $dockerfileSuffix = if ($Dockerfile -eq "Dockerfile.debian") { "-debian" } else { "" }
  $OutZip = "pindou-deploy${dockerfileSuffix}-{0}.zip" -f $timestamp
}
$Tmp = Join-Path $env:TEMP ("pindou_deploy_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -Path $Tmp -ItemType Directory | Out-Null

function CopyIfExists($relSrc, $relDst) {
  $src = Join-Path $Root $relSrc
  if (Test-Path $src) {
    $dst = Join-Path $Tmp $relDst
    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

Write-Host "Creating deploy package in $Tmp ..."
Write-Host "Using Dockerfile: $Dockerfile"

CopyIfExists "docker-compose.yml" "docker-compose.yml"
CopyIfExists $Dockerfile "Dockerfile"
CopyIfExists "env.example" "env.example"
CopyIfExists "package.json" "package.json"
CopyIfExists "package-lock.json" "package-lock.json"
CopyIfExists "DOCKER_DEPLOY.md" "DOCKER_DEPLOY.md"
CopyIfExists "QUICK_DEPLOY.md" "QUICK_DEPLOY.md"
CopyIfExists "README.md" "README.md"

# Always try to build the frontend if client source exists
if (Test-Path (Join-Path $Root "client\package.json")) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "Detected client/package.json and npm — building frontend before packaging..."
    Push-Location (Join-Path $Root "client")
    try {
      # Clean install dependencies - use npm install instead of npm ci to avoid cache issues
      Write-Host "Running npm install..."
      npm install --no-audit --no-fund

      # Force clean build
      Write-Host "Cleaning previous build..."
      if (Test-Path "build") {
        Remove-Item -Path "build" -Recurse -Force
      }

      Write-Host "Running npm run build..."
      npm run build

      if (-not (Test-Path "build")) {
        throw "Build directory not created after npm run build"
      }

      Write-Host "Frontend build completed successfully"
    } catch {
      Write-Host "Frontend build failed: $_" -ForegroundColor Red
      Pop-Location
      throw "Frontend build failed"
    }
    Pop-Location
  } else {
    Write-Host "npm not found — skipping frontend build. Make sure to build frontend manually before deployment." -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $Root "client\build"))) {
      throw "No prebuilt frontend found and npm not available. Cannot create deployment package."
    }
  }
}

# client package files
if (Test-Path (Join-Path $Root "client\package.json")) {
  New-Item -Path (Join-Path $Tmp "client") -ItemType Directory -Force | Out-Null
  Copy-Item -Path (Join-Path $Root "client\package.json") -Destination (Join-Path $Tmp "client\package.json") -Force
  if (Test-Path (Join-Path $Root "client\package-lock.json")) {
    Copy-Item -Path (Join-Path $Root "client\package-lock.json") -Destination (Join-Path $Tmp "client\package-lock.json") -Force
  }
}

# copy server excluding uploads and database.sqlite
if (Test-Path (Join-Path $Root "server")) {
  New-Item -Path (Join-Path $Tmp "server") -ItemType Directory -Force | Out-Null
  Get-ChildItem -Path (Join-Path $Root "server") -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\uploads\\' -and $_.Name -ne 'database.sqlite'
  } | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\','/')
    $dest = Join-Path $Tmp $rel
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Copy-Item -Path $_.FullName -Destination $dest -Force
  }
}

# If client/build exists, use prebuilt mode
if (Test-Path (Join-Path $Root "client\build")) {
  Write-Host "Found client/build — using prebuilt mode."
  New-Item -Path (Join-Path $Tmp "client") -ItemType Directory -Force | Out-Null
  Copy-Item -Path (Join-Path $Root "client\build") -Destination (Join-Path $Tmp "client\build") -Recurse -Force

  $dockerContent = @"
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY client/build ./server/public
RUN mkdir -p /app/data/database /app/data/uploads
EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000
CMD ["node", "server/index.js"]
"@
  $dockerContent | Out-File -FilePath (Join-Path $Tmp "Dockerfile") -Encoding utf8
} else {
  Write-Host "No client/build — copying client source (Docker will build frontend)."
  if (Test-Path (Join-Path $Root "client")) {
    Get-ChildItem -Path (Join-Path $Root "client") -Recurse -File | Where-Object {
      $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\build\\'
    } | ForEach-Object {
      $rel = $_.FullName.Substring($Root.Length).TrimStart('\','/')
      $dest = Join-Path $Tmp $rel
      New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
      Copy-Item -Path $_.FullName -Destination $dest -Force
    }
  }
}

# Create placeholder data directory (do not include real DB)
New-Item -Path (Join-Path $Tmp "data\database") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $Tmp "data\uploads") -ItemType Directory -Force | Out-Null

# Create zip
$cur = Get-Location
Set-Location $Tmp
if (Test-Path $OutZip) { Remove-Item $OutZip -Force }
Compress-Archive -Path * -DestinationPath (Join-Path $cur.Path $OutZip) -Force
Set-Location $cur

Write-Host "Created $OutZip"


