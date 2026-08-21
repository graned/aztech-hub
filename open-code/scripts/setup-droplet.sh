#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-droplet.sh [options]

Run from the deployed project directory on an Ubuntu/Debian DigitalOcean Droplet.
Installs Docker Engine, Buildx, and the Compose plugin when missing, validates the
production configuration, and starts the Workspace Manager + OpenCode Web stack.

Options:
  -d, --project-dir PATH  Project directory (default: current directory)
  -e, --env-file PATH     Production env file (default: .env.prod)
  -t, --timeout SECONDS   Health wait timeout (default: 240)
  -h, --help              Show this help
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

project_dir=$PWD
env_file=.env.prod
timeout_seconds=240

while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--project-dir) [[ $# -ge 2 ]] || fail "$1 requires a path"; project_dir=$2; shift 2 ;;
    --project-dir=*) project_dir=${1#*=}; shift ;;
    -e|--env-file) [[ $# -ge 2 ]] || fail "$1 requires a path"; env_file=$2; shift 2 ;;
    --env-file=*) env_file=${1#*=}; shift ;;
    -t|--timeout) [[ $# -ge 2 ]] || fail "$1 requires seconds"; timeout_seconds=$2; shift 2 ;;
    --timeout=*) timeout_seconds=${1#*=}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ $project_dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "project directory must be /opt/<name>"
[[ $env_file == /* ]] || env_file="$project_dir/$env_file"
[[ $timeout_seconds =~ ^[1-9][0-9]*$ ]] || fail "timeout must be a positive integer"
[[ -f $project_dir/docker-compose.prod.yml ]] || fail "docker-compose.prod.yml is missing"
[[ -f $project_dir/docker-compose.ssh.yml ]] || fail "docker-compose.ssh.yml is missing"
[[ -f $project_dir/Caddyfile.prod ]] || fail "Caddyfile.prod is missing"
[[ -f $env_file && ! -L $env_file ]] || fail "production env file is missing or a symlink: $env_file"

if [[ $(id -u) -eq 0 ]]; then
  sudo_cmd=()
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo_cmd=(sudo)
else
  fail "remote user must be root or have passwordless sudo"
fi

[[ $(uname -m) == x86_64 ]] || fail "only x86_64 Droplets are currently verified"
[[ -r /etc/os-release ]] || fail "/etc/os-release is unavailable"
. /etc/os-release
case ${ID:-} in
  ubuntu|debian) ;;
  *) fail "supported operating systems are Ubuntu and Debian, found ${ID:-unknown}" ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
  codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
  [[ -n $codename ]] || fail "could not determine apt distribution codename"
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y ca-certificates curl gnupg
  "${sudo_cmd[@]}" install -m 0755 -d /etc/apt/keyrings
  temporary_key=$(mktemp)
  trap 'rm -f "$temporary_key"' EXIT
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o "$temporary_key"
  docker_key_fingerprint=$(gpg --batch --show-keys --with-colons "$temporary_key" | awk -F: '$1 == "fpr" { print $10; exit }')
  [[ $docker_key_fingerprint == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]] || fail "Docker signing key fingerprint did not match"
  "${sudo_cmd[@]}" install -m 0644 "$temporary_key" /etc/apt/keyrings/docker.asc
  architecture=$(dpkg --print-architecture)
  "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $codename
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if command -v systemctl >/dev/null 2>&1; then
  "${sudo_cmd[@]}" systemctl enable --now docker
else
  "${sudo_cmd[@]}" service docker start
fi

docker_cmd=("${sudo_cmd[@]}" docker)
compose=("${docker_cmd[@]}" compose --project-directory "$project_dir" --env-file "$env_file" --env-file "$project_dir/.env.ssh" -f "$project_dir/docker-compose.prod.yml" -f "$project_dir/docker-compose.ssh.yml")

"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
"${compose[@]}" up -d --build --remove-orphans

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  app_id=$("${compose[@]}" ps -q app)
  opencode_id=$("${compose[@]}" ps -q opencode)
  caddy_id=$("${compose[@]}" ps -q caddy)
  if [[ -n $app_id && -n $opencode_id && -n $caddy_id ]]; then
    app_health=$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$app_id")
    opencode_health=$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$opencode_id")
    caddy_running=$("${docker_cmd[@]}" inspect --format '{{.State.Running}}' "$caddy_id")
    if [[ $app_health == healthy && $opencode_health == healthy && $caddy_running == true ]]; then
      "${compose[@]}" ps
      printf '%s\n' "Deployment is healthy. Verify https://workspace.aztech-hub.com and https://coding.aztech-hub.com after DNS propagates."
      exit 0
    fi
    if [[ $app_health == unhealthy || $opencode_health == unhealthy || $caddy_running == false ]]; then
      "${compose[@]}" logs --no-color --tail=100 app opencode caddy >&2
      fail "a production service became unhealthy"
    fi
  fi
  sleep 3
done

"${compose[@]}" ps >&2
"${compose[@]}" logs --no-color --tail=100 app opencode caddy >&2
fail "production services did not become healthy within ${timeout_seconds} seconds"
