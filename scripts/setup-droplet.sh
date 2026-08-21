#!/usr/bin/env bash
set -Eeuo pipefail

project_dir=${1:-/opt/aztech-hub}
[[ $project_dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  printf 'ERROR: project directory must be /opt/<name>\n' >&2
  exit 1
}

[[ -f $project_dir/docker-compose.prod.yml && -f $project_dir/.env.prod && -f $project_dir/.env.ssh ]] || {
  printf 'ERROR: unified deployment files are incomplete in %s\n' "$project_dir" >&2
  exit 1
}
if [[ $(id -u) -eq 0 ]]; then sudo_cmd=(); elif sudo -n true >/dev/null 2>&1; then sudo_cmd=(sudo); else sudo_cmd=(); fi
docker_cmd=("${sudo_cmd[@]}" docker)
"${docker_cmd[@]}" info >/dev/null 2>&1 || { printf 'ERROR: Docker is not installed or not accessible\n' >&2; exit 1; }
"${docker_cmd[@]}" compose version >/dev/null 2>&1 || { printf 'ERROR: Docker Compose is not installed\n' >&2; exit 1; }
"${docker_cmd[@]}" buildx version >/dev/null 2>&1 || { printf 'ERROR: Docker Buildx is not installed\n' >&2; exit 1; }

compose=("${sudo_cmd[@]}" docker compose --project-directory "$project_dir" --env-file "$project_dir/.env.prod" --env-file "$project_dir/.env.ssh" -f "$project_dir/docker-compose.prod.yml" -f "$project_dir/docker-compose.ssh.yml")
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
"${compose[@]}" up -d --build --remove-orphans

deadline=$((SECONDS + ${AZTECH_HUB_HEALTH_TIMEOUT:-300}))
while (( SECONDS < deadline )); do
  workspace_id=$("${compose[@]}" ps -q workspace-manager)
  opencode_id=$("${compose[@]}" ps -q opencode)
  design_id=$("${compose[@]}" ps -q open-design)
  caddy_id=$("${compose[@]}" ps -q caddy)
  if [[ -n $workspace_id && -n $opencode_id && -n $design_id && -n $caddy_id ]]; then
    workspace_health=$("${sudo_cmd[@]}" docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$workspace_id")
    opencode_health=$("${sudo_cmd[@]}" docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$opencode_id")
    design_health=$("${sudo_cmd[@]}" docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$design_id")
    caddy_running=$("${sudo_cmd[@]}" docker inspect --format '{{.State.Running}}' "$caddy_id")
    if [[ $workspace_health == healthy && $opencode_health == healthy && $design_health == healthy && $caddy_running == true ]]; then
      "${compose[@]}" ps
      exit 0
    fi
    if [[ $workspace_health == unhealthy || $opencode_health == unhealthy || $design_health == unhealthy || $caddy_running == false ]]; then
      "${compose[@]}" logs --no-color --tail=100 workspace-manager opencode open-design caddy >&2
      printf 'ERROR: a unified service became unhealthy\n' >&2
      exit 1
    fi
  fi
  sleep 3

"${compose[@]}" ps >&2
"${compose[@]}" logs --no-color --tail=100 workspace-manager opencode open-design caddy >&2
printf 'ERROR: unified services did not become healthy within the timeout\n' >&2
exit 1
