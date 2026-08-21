#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf '%s\n' "Usage: scripts/start.sh local|prod [--no-ssh]"
}

mode=${1:-}
[[ $mode == local || $mode == prod ]] || { usage >&2; exit 2; }
use_ssh=1
if [[ ${2:-} == --no-ssh ]]; then use_ssh=0; fi

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
env_file="$root_dir/.env.$mode"
compose_file="$root_dir/docker-compose.$mode.yml"
[[ -f $env_file ]] || { printf 'ERROR: missing %s\n' "$env_file" >&2; exit 1; }
[[ -f $compose_file ]] || { printf 'ERROR: missing %s\n' "$compose_file" >&2; exit 1; }

compose=(docker compose --env-file "$env_file" -f "$compose_file")
if [[ $use_ssh == 1 ]]; then
  ssh_env=$root_dir/.env.ssh
  [[ -f $ssh_env ]] || ssh_env=$root_dir/open-code/.env.ssh
  [[ -f $ssh_env ]] || {
    printf '%s\n' 'ERROR: missing .env.ssh; run open-code/scripts/setup-github-ssh.sh or use --no-ssh' >&2
    exit 1
  }
  compose+=(--env-file "$ssh_env" -f "$root_dir/docker-compose.ssh.yml")
fi

"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --remove-orphans
"${compose[@]}" ps
