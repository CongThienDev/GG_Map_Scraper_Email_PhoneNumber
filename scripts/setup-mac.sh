#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js LTS with Homebrew..."
    brew install node
  else
    echo "Node.js LTS is required. Install it from https://nodejs.org/, then run this script again."
    exit 1
  fi
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node --version)). Upgrade Node.js, then run this script again."
  exit 1
fi

echo "Installing project dependencies and Chromium..."
npm ci

if [ ! -f .env ]; then
  read -r -p "Admin username: " maps_setup_admin_user
  read -r -s -p "Admin password (at least 8 characters): " maps_setup_admin_password
  echo
  read -r -p "Concurrent scrape jobs [2]: " maps_setup_max_concurrent
  maps_setup_max_concurrent="${maps_setup_max_concurrent:-2}"

  MAPS_SETUP_ADMIN_USER="$maps_setup_admin_user" \
    MAPS_SETUP_ADMIN_PASSWORD="$maps_setup_admin_password" \
    MAPS_SETUP_MAX_CONCURRENT="$maps_setup_max_concurrent" \
    node scripts/create-local-env.js
  unset maps_setup_admin_password
else
  echo ".env already exists; keeping its credentials and settings."
fi

echo
echo "Setup complete. Run: ./scripts/run-mac.sh"
