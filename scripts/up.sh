#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Validate env files exist.
for f in .env.crosswordapi .env.tauth; do
  if [ ! -f "$f" ]; then
    echo "Missing $f — copy from ${f}.example and fill in values."
    exit 1
  fi
done

docker compose up --build "$@"
