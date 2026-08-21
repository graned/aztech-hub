#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-droplet.sh [options] <user@host> [remote-directory]

Deploys the complete aztech-hub unified stack to an Ubuntu/Debian x86_64
DigitalOcean Droplet. Docker is installed remotely when needed. The project
bundle, .env.prod, and GitHub SSH runtime files are transferred over SSH.

Options:
  -i, --ssh-key PATH       Droplet SSH identity
  -p, --ssh-port PORT      Droplet SSH port (default: 22)
  -g, --github-key PATH    GitHub clone private key
  -k, --known-hosts PATH   GitHub known_hosts file
  -h, --help               Show help
EOF
}

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
ssh_port=${SSH_PORT:-22}; ssh_key=${SSH_KEY:-}; positional=()
github_key=${OPENCODE_SSH_KEY_PATH:-${HOME}/.config/opencode-workspace-manager/ssh/id_ed25519}
known_hosts=${OPENCODE_KNOWN_HOSTS_PATH:-${HOME}/.config/opencode-workspace-manager/ssh/known_hosts}

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
target=$1; remote_dir=${2:-/opt/aztech-hub}
[[ $target =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || fail "destination must be user@host"
[[ $remote_dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "remote directory must be /opt/<name>"
[[ $ssh_port =~ ^[1-9][0-9]{0,4}$ && $ssh_port -le 65535 ]] || fail "SSH port is invalid"

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v ssh >/dev/null 2>&1 || fail "ssh is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"
[[ -f $root_dir/.env.prod && ! -L $root_dir/.env.prod ]] || fail "missing .env.prod"
[[ -f $github_key && ! -L $github_key ]] || fail "missing GitHub private key: $github_key"
[[ -f $known_hosts && ! -L $known_hosts ]] || fail "missing GitHub known_hosts: $known_hosts"

for required in DESIGN_URL WORKSPACE_URL CODING_URL MONGODB_URI MONGO_INITDB_ROOT_USERNAME MONGO_INITDB_ROOT_PASSWORD OPENCODE_SERVER_USERNAME OPENCODE_SERVER_PASSWORD OPENCODE_BASIC_AUTH BASIC_AUTH_USER BASIC_AUTH_HASH SESSION_TOKEN; do
  grep -Eq "^[[:space:]]*${required}=[^[:space:]]" "$root_dir/.env.prod" || fail "$required must be set in .env.prod"
done

ssh_args=(-p "$ssh_port" -o ConnectTimeout=15 -o StrictHostKeyChecking=yes)
[[ -n $ssh_key ]] && ssh_args+=(-i "$ssh_key" -o IdentitiesOnly=yes)

ssh "${ssh_args[@]}" "$target" bash -s <<'REMOTE_BOOTSTRAP'
set -Eeuo pipefail
if [[ $(id -u) -eq 0 ]]; then sudo_cmd=(); elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then sudo_cmd=(sudo); else echo 'ERROR: root or passwordless sudo is required' >&2; exit 1; fi
[[ -r /etc/os-release ]] || { echo 'ERROR: /etc/os-release unavailable' >&2; exit 1; }; . /etc/os-release
case ${ID:-} in ubuntu|debian) ;; *) echo "ERROR: unsupported OS ${ID:-unknown}" >&2; exit 1 ;; esac
[[ $(uname -m) == x86_64 ]] || { echo 'ERROR: x86_64 is required' >&2; exit 1; }
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
  codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}; [[ -n $codename ]] || exit 1
  "${sudo_cmd[@]}" apt-get update; "${sudo_cmd[@]}" apt-get install -y ca-certificates curl gnupg
  "${sudo_cmd[@]}" install -m 0755 -d /etc/apt/keyrings; key=$(mktemp)
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o "$key"
  fingerprint=$(gpg --batch --show-keys --with-colons "$key" | awk -F: '$1 == "fpr" { print $10; exit }')
  [[ $fingerprint == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]] || exit 1
  "${sudo_cmd[@]}" install -m 0644 "$key" /etc/apt/keyrings/docker.asc; rm -f "$key"
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
REMOTE_BOOTSTRAP

archive=$(mktemp /tmp/aztech-hub.XXXXXX.tar.gz)
tar -C "$root_dir" -czf "$archive" \
  --exclude=.git --exclude=node_modules --exclude=.next --exclude=coverage --exclude=.codegraph \
  --exclude=.omo --exclude=.playwright-mcp --exclude=test-results --exclude=playwright-report \
  --exclude='.env*' --exclude='.ssh' --exclude=runtime-ssh .
remote_archive=$(cat "$archive" | ssh "${ssh_args[@]}" "$target" 'set -eu; file=$(mktemp /tmp/aztech-hub-bundle.XXXXXX.tar.gz); cat > "$file"; printf "%s" "$file"')
rm -f "$archive"
remote_env=$(cat "$root_dir/.env.prod" | ssh "${ssh_args[@]}" "$target" 'set -eu; file=$(mktemp /tmp/aztech-hub-env.XXXXXX); cat > "$file"; printf "%s" "$file"')
remote_key=$(cat "$github_key" | ssh "${ssh_args[@]}" "$target" 'set -eu; file=$(mktemp /tmp/aztech-hub-key.XXXXXX); cat > "$file"; printf "%s" "$file"')
remote_known=$(cat "$known_hosts" | ssh "${ssh_args[@]}" "$target" 'set -eu; file=$(mktemp /tmp/aztech-hub-known.XXXXXX); cat > "$file"; printf "%s" "$file"')

ssh "${ssh_args[@]}" "$target" bash -s -- "$remote_dir" "$remote_archive" "$remote_env" "$remote_key" "$remote_known" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
dir=$1; bundle=$2; env_file=$3; key_file=$4; known_file=$5
if [[ $(id -u) -eq 0 ]]; then sudo_cmd=(); elif sudo -n true >/dev/null 2>&1; then sudo_cmd=(sudo); else exit 1; fi
[[ $dir =~ ^/opt/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || exit 1
stage=$(mktemp -d /tmp/aztech-hub-stage.XXXXXX); trap 'rm -rf "$stage" "$bundle" "$env_file" "$key_file" "$known_file"' EXIT
tar --no-same-owner --no-same-permissions -xzf "$bundle" -C "$stage"
"${sudo_cmd[@]}" install -d -o root -g root -m 0755 "$dir" "$dir/scripts" "$dir/runtime-ssh"
"${sudo_cmd[@]}" cp -a "$stage/." "$dir/"
"${sudo_cmd[@]}" install -o root -g root -m 0600 "$env_file" "$dir/.env.prod"
"${sudo_cmd[@]}" install -o root -g root -m 0600 "$key_file" "$dir/runtime-ssh/id_ed25519"
"${sudo_cmd[@]}" install -o root -g root -m 0644 "$known_file" "$dir/runtime-ssh/known_hosts"
"${sudo_cmd[@]}" tee "$dir/.env.ssh" >/dev/null <<EOF
OPENCODE_SSH_KEY_PATH=$dir/runtime-ssh/id_ed25519
OPENCODE_KNOWN_HOSTS_PATH=$dir/runtime-ssh/known_hosts
EOF
"${sudo_cmd[@]}" chmod 0600 "$dir/.env.ssh"
"${sudo_cmd[@]}" bash "$dir/scripts/setup-droplet.sh" "$dir"
REMOTE_DEPLOY

printf '%s\n' 'Unified aztech-hub deployment completed.'
