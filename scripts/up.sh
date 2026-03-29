#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

compose_up_args=""

if [ "$#" -gt 0 ]; then
  compose_up_args="$*"
fi

if [ -n "$compose_up_args" ]; then
  exec make up COMPOSE_UP_ARGS="$compose_up_args"
fi

exec make up
