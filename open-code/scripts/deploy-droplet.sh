#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-droplet.sh [options] <user@host> [remote-directory]

Bootstraps Docker on an Ubuntu/Debian DigitalOcean Droplet, uploads this project,
production secrets, and the GitHub SSH runtime key over SSH, then runs the remote
setup script. The Droplet does not need Git.

Options:
  -i, --ssh-key PATH       SSH identity used to connect to the Droplet
  -p, --ssh-port PORT      SSH port (default: 22)
  -g, --github-key PATH    GitHub clone key (default: OPENCODE_SSH_KEY_PATH or setup key)
  -k, --known-hosts PATH   GitHub known_hosts (default: OPENCODE_KNOWN_HOSTS_PATH or setup file)
  -h, --help               Show this help

Required local file:
  .env.prod                Production environment; never commit it
EOF
}

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

ssh_port=${SSH_PORT:-22}
ssh_key=${SSH_KEY:-}
github_key=${OPENCODE_SSH_KEY_PATH:-${HOME}/.config/opencode-workspace-manager/ssh/id_ed25519}
known_hosts=${OPENCODE_KNOWN_HOSTS_PATH:-${HOME}/.config/opencode-workspace-manager/ssh/known_hosts}
positional=()

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--ssh-key) [[ $# -ge 2 ]] || fail "$1 requires a path"; ssh_key=$2; shift 2 ;;
    --ssh-key=*) ssh_key=${1#*=}; shift ;;
    -p|--ssh-port) [[ $# -ge 2 ]] || fail "$1 requires a port"; ssh_port=$2; shift 2 ;;
    --ssh-port=*) ssh_port=${1#*=}; shift ;;
    -g|--github-key) [[ $# -ge 2 ]] || fail "$1 requires a path"; github_key=$2; shift 2 ;;
    --github-key=*) github_key=${1#*=}; shift ;;
    -k|--known-hosts) [[ $# -ge 2 ]] || fail "$1 requires a path"; known_hosts=$2; shift 2 ;;
    --known-hosts=*) known_hosts=${1#*=}; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; positional+=("$@"); break ;;
    -*) fail "unknown option: $1" ;;
    *) positional+=("$1"); shift ;;
  esac
done

set -- "${positional[@]}"
[[ $# -ge 1 && $# -le 2 ]] || { usage >&2; exit 2; }
target=$1
remote_dir=${2:-/opt/aztech-opencode-workspace-manager}
[[ $target =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || fail "destination must be user@host"
[[ $remote_dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "remote directory must be /opt/<name>"
[[ $ssh_port =~ ^[1-9][0-9]{0,4}$ && $ssh_port -le 65535 ]] || fail "SSH port is invalid"

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v ssh >/dev/null 2>&1 || fail "ssh is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"
[[ -f $project_dir/.env.prod && ! -L $project_dir/.env.prod ]] || fail "missing regular .env.prod"
[[ -f $github_key && ! -L $github_key ]] || fail "missing GitHub private key: $github_key"
[[ -f $known_hosts && ! -L $known_hosts ]] || fail "missing GitHub known_hosts: $known_hosts"

  for required_key in WORKSPACE_URL CODING_URL MONGODB_URI MONGO_INITDB_ROOT_USERNAME MONGO_INITDB_ROOT_PASSWORD OPENCODE_SERVER_USERNAME OPENCODE_SERVER_PASSWORD OPENCODE_BASIC_AUTH BASIC_AUTH_USER BASIC_AUTH_HASH; do
  grep -Eq "^[[:space:]]*${required_key}=[^[:space:]]" "$project_dir/.env.prod" \
    || fail "$required_key must be set in .env.prod"
done

ssh_args=(-p "$ssh_port" -o ConnectTimeout=15 -o StrictHostKeyChecking=yes)
[[ -n $ssh_key ]] && ssh_args+=(-i "$ssh_key" -o IdentitiesOnly=yes)

printf 'Bootstrapping Docker on %s...\n' "$target"
ssh "${ssh_args[@]}" "$target" bash -s <<'REMOTE_BOOTSTRAP'
set -Eeuo pipefail
if [[ $(id -u) -eq 0 ]]; then sudo_cmd=(); elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then sudo_cmd=(sudo); else echo 'ERROR: root or passwordless sudo is required' >&2; exit 1; fi
[[ -r /etc/os-release ]] || { echo 'ERROR: /etc/os-release is unavailable' >&2; exit 1; }
. /etc/os-release
case ${ID:-} in ubuntu|debian) ;; *) echo "ERROR: unsupported OS: ${ID:-unknown}" >&2; exit 1 ;; esac
[[ $(uname -m) == x86_64 ]] || { echo 'ERROR: only x86_64 Droplets are supported' >&2; exit 1; }
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
  codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
  [[ -n $codename ]] || { echo 'ERROR: apt codename unavailable' >&2; exit 1; }
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y ca-certificates curl gnupg
  "${sudo_cmd[@]}" install -m 0755 -d /etc/apt/keyrings
  tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o "$tmp"
  fingerprint=$(gpg --batch --show-keys --with-colons "$tmp" | awk -F: '$1 == "fpr" { print $10; exit }')
  [[ $fingerprint == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]] || { echo 'ERROR: Docker signing key mismatch' >&2; exit 1; }
  "${sudo_cmd[@]}" install -m 0644 "$tmp" /etc/apt/keyrings/docker.asc
  arch=$(dpkg --print-architecture)
  "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $codename
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if command -v systemctl >/dev/null 2>&1; then "${sudo_cmd[@]}" systemctl enable --now docker; else "${sudo_cmd[@]}" service docker start; fi
"${sudo_cmd[@]}" docker info >/dev/null
"${sudo_cmd[@]}" docker compose version >/dev/null
REMOTE_BOOTSTRAP

printf 'Uploading source bundle and runtime secrets...\n'
remote_archive=$(tar -C "$project_dir" -czf - \
  --exclude=.git --exclude=node_modules --exclude=.next --exclude=out --exclude=coverage \
  --exclude=.codegraph --exclude=.omo --exclude=.playwright-mcp --exclude=test-results \
  --exclude=playwright-report --exclude='.env*' --exclude='.ssh' --exclude=runtime-ssh . | \
  ssh "${ssh_args[@]}" "$target" 'set -eu; umask 077; archive=$(mktemp /tmp/aztech-opencode.XXXXXX.tar.gz); cat > "$archive"; printf "%s" "$archive"')
[[ $remote_archive =~ ^/tmp/aztech-opencode\.[A-Za-z0-9]+\.tar\.gz$ ]] || fail "remote archive path was invalid"

remote_env=$(cat "$project_dir/.env.prod" | ssh "${ssh_args[@]}" "$target" 'set -eu; umask 077; file=$(mktemp /tmp/aztech-opencode-env.XXXXXX); cat > "$file"; printf "%s" "$file"')
remote_github_key=$(cat "$github_key" | ssh "${ssh_args[@]}" "$target" 'set -eu; umask 077; file=$(mktemp /tmp/aztech-opencode-key.XXXXXX); cat > "$file"; printf "%s" "$file"')
remote_known_hosts=$(cat "$known_hosts" | ssh "${ssh_args[@]}" "$target" 'set -eu; umask 077; file=$(mktemp /tmp/aztech-opencode-known.XXXXXX); cat > "$file"; printf "%s" "$file"')

printf 'Installing bundle and starting production stack...\n'
ssh "${ssh_args[@]}" "$target" bash -s -- "$remote_dir" "$remote_archive" "$remote_env" "$remote_github_key" "$remote_known_hosts" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
remote_dir=$1; remote_archive=$2; remote_env=$3; remote_github_key=$4; remote_known_hosts=$5
if [[ $(id -u) -eq 0 ]]; then sudo_cmd=(); elif sudo -n true >/dev/null 2>&1; then sudo_cmd=(sudo); else echo 'ERROR: passwordless sudo is required' >&2; exit 1; fi
[[ $remote_dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'ERROR: unsafe remote directory' >&2; exit 1; }
[[ $remote_archive =~ ^/tmp/aztech-opencode\.[A-Za-z0-9]+\.tar\.gz$ ]] || { echo 'ERROR: unsafe archive path' >&2; exit 1; }
staging=$(mktemp -d /tmp/aztech-opencode-stage.XXXXXX); trap 'rm -rf "$staging" "$remote_archive" "$remote_env" "$remote_github_key" "$remote_known_hosts"' EXIT
tar --no-same-owner --no-same-permissions -xzf "$remote_archive" -C "$staging"
"${sudo_cmd[@]}" install -d -o root -g root -m 0755 "$remote_dir" "$remote_dir/scripts" "$remote_dir/runtime-ssh"
"${sudo_cmd[@]}" cp -a "$staging/." "$remote_dir/"
"${sudo_cmd[@]}" install -o root -g root -m 0600 "$remote_env" "$remote_dir/.env.prod"
"${sudo_cmd[@]}" install -o root -g root -m 0600 "$remote_github_key" "$remote_dir/runtime-ssh/id_ed25519"
"${sudo_cmd[@]}" install -o root -g root -m 0644 "$remote_known_hosts" "$remote_dir/runtime-ssh/known_hosts"
"${sudo_cmd[@]}" tee "$remote_dir/.env.ssh" >/dev/null <<EOF
OPENCODE_SSH_KEY_PATH=$remote_dir/runtime-ssh/id_ed25519
OPENCODE_KNOWN_HOSTS_PATH=$remote_dir/runtime-ssh/known_hosts
EOF
"${sudo_cmd[@]}" chmod 0600 "$remote_dir/.env.ssh"
"${sudo_cmd[@]}" bash "$remote_dir/scripts/setup-droplet.sh" --project-dir "$remote_dir" --env-file "$remote_dir/.env.prod"
REMOTE_DEPLOY

printf '\nDeployment completed. Verify:\n  https://workspace.aztech-hub.com\n  https://coding.aztech-hub.com\n'
