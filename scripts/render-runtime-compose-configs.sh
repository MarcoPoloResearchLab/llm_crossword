#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly runtime_directory=".runtime"
readonly site_origin="${SITE_ORIGIN:-http://localhost:8000}"
readonly site_port="${CROSSWORD_PORT:-8000}"
readonly tauth_host_port="${TAUTH_HOST_PORT:-8081}"
readonly api_host_port="${CROSSWORD_API_HOST_PORT:-9090}"
readonly ledger_host_port="${LEDGER_HOST_PORT:-50051}"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

render_local_origin_copy() {
  local source_path="$1"
  local destination_path="$2"
  local escaped_site_origin
  local temporary_path

  if [ ! -f "$source_path" ]; then
    echo "Missing $source_path." >&2
    return 1
  fi

  escaped_site_origin="$(escape_sed_replacement "$site_origin")"
  temporary_path="$(mktemp "${destination_path}.XXXXXX")"
  sed "s|http://localhost:8000|$escaped_site_origin|g" "$source_path" > "$temporary_path"
  mv "$temporary_path" "$destination_path"
}

render_ports_file() {
  local destination_path="$1"
  local temporary_path

  temporary_path="$(mktemp "${destination_path}.XXXXXX")"
  cat > "$temporary_path" <<EOF
SITE_ORIGIN=$site_origin
CROSSWORD_PORT=$site_port
TAUTH_HOST_PORT=$tauth_host_port
CROSSWORD_API_HOST_PORT=$api_host_port
LEDGER_HOST_PORT=$ledger_host_port
INTEGRATION_URL=$site_origin
INTEGRATION_TAUTH_URL=http://localhost:$tauth_host_port
INTEGRATION_API_URL=http://localhost:$api_host_port
SITE_CONFIG_SOURCE=./$runtime_directory/config.yaml
TAUTH_CONFIG_SOURCE=./$runtime_directory/tauth.config.yaml
EOF
  mv "$temporary_path" "$destination_path"
}

main() {
  mkdir -p "$runtime_directory"
  render_local_origin_copy "config.yaml" "$runtime_directory/config.yaml"
  render_local_origin_copy "tauth.config.yaml" "$runtime_directory/tauth.config.yaml"
  render_ports_file "$runtime_directory/ports.env"
}

main "$@"
