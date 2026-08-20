#!/usr/bin/env bash
set -Eeuo pipefail

readonly ssh_root="${OPENCODE_SSH_DIR:-${HOME}/.config/opencode-workspace-manager/ssh}"
readonly key_path="${OPENCODE_SSH_KEY_PATH:-${ssh_root}/id_ed25519}"
readonly known_hosts_path="${OPENCODE_KNOWN_HOSTS_PATH:-${ssh_root}/known_hosts}"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

[[ -r "${key_path}" ]] || die "SSH private key is missing or unreadable: ${key_path}"
[[ -r "${known_hosts_path}" ]] || die "known_hosts is missing or unreadable: ${known_hosts_path}"

ssh_output="$(ssh \
  -i "${key_path}" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="${known_hosts_path}" \
  -T git@github.com 2>&1 || true)"
if [[ "${ssh_output}" != *"successfully authenticated"* ]]; then
  printf '%s\n' "${ssh_output}" >&2
  die "GitHub SSH authentication failed."
fi

printf '%s\n' "${ssh_output}"

if [[ "${1:-}" != "" ]]; then
  repository="${1#github.com/}"
  repository="${repository#git@github.com:}"
  repository="${repository%.git}"
  [[ "${repository}" == */* ]] || die "Repository must be owner/name or git@github.com:owner/name.git."
  GIT_SSH_COMMAND="ssh -i ${key_path} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known_hosts_path}" \
    git ls-remote "git@github.com:${repository}.git" HEAD >/dev/null \
    || die "GitHub SSH can authenticate but cannot read ${repository}."
  printf '%s\n' "Repository access succeeded: ${repository}"
fi
