#!/usr/bin/env bash
set -Eeuo pipefail

image=${1:?Usage: scripts/check-standalone-next-runtime.sh <production-image>}
command -v docker >/dev/null 2>&1 || {
  printf 'ERROR: docker is required\n' >&2
  exit 1
}

docker run --rm "$image" sh -c '
  path=$(printf "%s\n" /app/node_modules/.pnpm/next@*/node_modules/@swc/helpers/esm/_interop_require_default.js)
  test -f "$path"
  printf "OK: %s\n" "$path"
'
