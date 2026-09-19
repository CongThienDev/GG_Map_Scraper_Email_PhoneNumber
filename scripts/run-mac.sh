#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [ ! -f .env ]; then
  echo "Missing .env. Run ./scripts/setup-mac.sh first."
  exit 1
fi

echo "Starting Maps Scraper at http://localhost:8080 (Mac sleep is prevented while it runs)."
exec caffeinate -i -s npm start
