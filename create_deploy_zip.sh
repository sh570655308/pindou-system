#!/usr/bin/env bash
set -euo pipefail

OUT_ZIP="${1:-pindou-deploy-$(date +%Y%m%d-%H%M%S).zip}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

echo "Creating deploy package in $TMPDIR ..."

# helper copy if exists
copy_if_exists() {
  local src="$1" dst="$2"
  if [ -e "$ROOT_DIR/$src" ]; then
    mkdir -p "$(dirname "$TMPDIR/$dst")"
    cp -a "$ROOT_DIR/$src" "$TMPDIR/$dst"
  fi
}

# Always copy top-level deployment files
copy_if_exists "Dockerfile" "Dockerfile"
copy_if_exists "docker-compose.yml" "docker-compose.yml"
copy_if_exists "env.example" "env.example"
copy_if_exists "package.json" "package.json"
copy_if_exists "package-lock.json" "package-lock.json"
copy_if_exists "DOCKER_DEPLOY.md" "DOCKER_DEPLOY.md"
copy_if_exists "QUICK_DEPLOY.md" "QUICK_DEPLOY.md"
copy_if_exists "README.md" "README.md"

# If client source exists and npm is available, build the frontend so client/build is included.
# This makes the deploy zip contain an up-to-date `client/build` without requiring build on the target.
if [ -f "$ROOT_DIR/client/package.json" ] && command -v npm >/dev/null 2>&1; then
  echo "Detected client package.json and npm — building frontend before packaging..."
  # Prefer reproducible install with package-lock if present
  if [ -f "$ROOT_DIR/client/package-lock.json" ]; then
    (cd "$ROOT_DIR/client" && npm ci) || { echo "npm ci failed, trying npm install..."; (cd "$ROOT_DIR/client" && npm install) || { echo "npm install failed"; exit 1; } }
  else
    (cd "$ROOT_DIR/client" && npm install) || { echo "npm install failed"; exit 1; }
  fi

  # Run build
  (cd "$ROOT_DIR/client" && npm run build) || { echo "Frontend build failed"; exit 1; }
fi

# Copy client package files (needed if building inside Docker)
if [ -e "$ROOT_DIR/client/package.json" ]; then
  mkdir -p "$TMPDIR/client"
  cp -a "$ROOT_DIR/client/package.json" "$TMPDIR/client/package.json" || true
  cp -a "$ROOT_DIR/client/package-lock.json" "$TMPDIR/client/package-lock.json" 2>/dev/null || true
fi

# Copy server source (exclude uploads, database.sqlite if present)
if [ -d "$ROOT_DIR/server" ]; then
  mkdir -p "$TMPDIR/server"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude 'node_modules' --exclude 'uploads' --exclude 'database.sqlite' "$ROOT_DIR/server/" "$TMPDIR/server/"
  else
    (cd "$ROOT_DIR/server" && find . -type d -name node_modules -prune -o -name uploads -prune -o -name database.sqlite -prune -o -print0) | \
      (cd "$TMPDIR/server" && xargs -0 -I{} bash -c 'mkdir -p "$(dirname "{}")"; cp -a "$ROOT_DIR/server/{}" "{}"' )
  fi
fi

# If client/build exists, use prebuilt mode: copy build and create a simplified Dockerfile that uses build
if [ -d "$ROOT_DIR/client/build" ]; then
  echo "Found client/build — using prebuilt mode (smaller package)."
  mkdir -p "$TMPDIR/client"
  cp -a "$ROOT_DIR/client/build" "$TMPDIR/client/build"
  # create simplified Dockerfile that copies prebuilt build into server/public
  cat > "$TMPDIR/Dockerfile" <<'DOCK'
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
DOCK
else
  echo "No client/build found — copying client source (Docker will build frontend during image build)."
  # copy entire client excluding node_modules and build
  if [ -d "$ROOT_DIR/client" ]; then
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude 'node_modules' --exclude 'build' "$ROOT_DIR/client/" "$TMPDIR/client/"
    else
      (cd "$ROOT_DIR/client" && find . -type d -name node_modules -prune -o -name build -prune -print0) | \
        (cd "$TMPDIR/client" && xargs -0 -I{} bash -c 'mkdir -p "$(dirname "{}")"; cp -a "$ROOT_DIR/client/{}" "{}"' )
    fi
  fi
fi

# Exclude any large data or temporary dirs at root; create placeholders
mkdir -p "$TMPDIR/data/database" "$TMPDIR/data/uploads"

# Create zip
OLDPWD="$(pwd)"
cd "$TMPDIR"
zip -r -9 "$OLDPWD/$OUT_ZIP" . >/dev/null
cd "$OLDPWD"

echo "Created $OUT_ZIP"


