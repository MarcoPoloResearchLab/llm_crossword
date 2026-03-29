#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

compose_down_args=""

if [ "$#" -gt 0 ]; then
  compose_down_args="$*"
fi

if [ -n "$compose_down_args" ]; then
  exec make down COMPOSE_DOWN_ARGS="$compose_down_args"
fi

exec make down
