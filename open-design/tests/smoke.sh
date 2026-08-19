#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.local.yml}
ENV_FILE=${ENV_FILE:-.env.local}
BASE_URL=${BASE_URL:-https://design.localhost}
CA_FILE=${CA_FILE:-}
CHECK_PERSISTENCE=${CHECK_PERSISTENCE:-0}
SMOKE_TIMEOUT_SECONDS=${SMOKE_TIMEOUT_SECONDS:-120}
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

pass() {
    printf 'PASS: %s\n' "$1"
}

compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

[[ -r "$COMPOSE_FILE" ]] || fail "compose file is not readable"
[[ -r "$ENV_FILE" ]] || fail "environment file is not readable"
[[ -n ${BASIC_AUTH_USER:-} ]] || fail "BASIC_AUTH_USER is required"
[[ -n ${BASIC_AUTH_PASSWORD:-} ]] || fail "BASIC_AUTH_PASSWORD is required"
[[ $BASIC_AUTH_USER != *:* ]] || fail "BASIC_AUTH_USER must not contain a colon"
[[ $CHECK_PERSISTENCE == 0 || $CHECK_PERSISTENCE == 1 ]] || fail "CHECK_PERSISTENCE must be 0 or 1"
[[ $SMOKE_TIMEOUT_SECONDS =~ ^[1-9][0-9]*$ ]] || fail "SMOKE_TIMEOUT_SECONDS must be a positive integer"
if [[ -n $CA_FILE ]]; then
    [[ -r $CA_FILE ]] || fail "CA_FILE is not readable"
fi

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
compose config --quiet >/dev/null || fail "compose configuration is invalid"

wait_for_healthy() {
    local container_id deadline health
    deadline=$((SECONDS + SMOKE_TIMEOUT_SECONDS))

    while (( SECONDS < deadline )); do
        container_id=$(compose ps -q open-design 2>/dev/null || true)
        if [[ -n $container_id ]]; then
            health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)
            [[ $health == healthy ]] && return 0
            [[ $health == unhealthy ]] && return 1
        fi
        sleep 2
    done
    return 1
}

wait_for_healthy || fail "open-design did not become healthy within the bounded wait"
pass "open-design is healthy"

caddy_publishes=0
for service in open-design caddy; do
    mapfile -t container_ids < <(compose ps -q "$service")
    (( ${#container_ids[@]} > 0 )) || fail "a configured service is not running"

    for container_id in "${container_ids[@]}"; do
        bindings=$(docker inspect --format '{{range $port, $items := .HostConfig.PortBindings}}{{if $items}}{{$port}} {{end}}{{end}}' "$container_id")
        if [[ $service == caddy ]]; then
            [[ -n $bindings ]] && caddy_publishes=1
        elif [[ -n $bindings ]]; then
            fail "a service other than caddy publishes a host port"
        fi
    done
done
(( caddy_publishes == 1 )) || fail "caddy does not publish a host port"
pass "only caddy publishes host ports"

initializer_id=$(compose ps -a -q configure-open-design)
[[ -n $initializer_id ]] || fail "Open Design initializer container is missing"
initializer_status=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$initializer_id")
[[ $initializer_status == 'exited:0' ]] || fail "Open Design initializer did not complete successfully"
pass "Open Design initializer completed successfully"

if curl --noproxy '*' --silent --output /dev/null --connect-timeout 2 --max-time 3 http://127.0.0.1:7456/ 2>/dev/null; then
    fail "host port 7456 is reachable"
fi
pass "host port 7456 is unreachable"

curl_common=(
    --noproxy '*'
    --silent
    --output /dev/null
    --connect-timeout 5
    --max-time 15
    --write-out '%{http_code}'
)
if [[ -n $CA_FILE ]]; then
    curl_common+=(--cacert "$CA_FILE")
fi

http_status() {
    local auth_mode=$1 path=$2
    local -a request=("${curl_common[@]}")

    case $auth_mode in
        none) ;;
        valid) request+=(--user "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD") ;;
        wrong) request+=(--user "$BASIC_AUTH_USER:${BASIC_AUTH_PASSWORD}__smoke_invalid") ;;
        *) return 2 ;;
    esac

    request+=("${BASE_URL%/}$path")
    curl "${request[@]}"
}

assert_status() {
    local expected=$1 auth_mode=$2 path=$3 actual
    if ! actual=$(http_status "$auth_mode" "$path"); then
        fail "HTTP request failed before returning a status"
    fi
    [[ $actual == "$expected" ]] || fail "HTTP response had an unexpected status"
}

assert_success() {
    local path=$1 actual
    if ! actual=$(http_status valid "$path"); then
        fail "authenticated HTTP request failed before returning a status"
    fi
    [[ $actual =~ ^2[0-9][0-9]$ ]] || fail "authenticated HTTP response was not successful"
}

assert_status 401 none /
assert_status 401 wrong /
pass "unauthenticated and incorrect credentials are rejected"

assert_success /
assert_success /api/health
pass "valid credentials reach the application and health endpoint"

cookie_request=(
    --noproxy '*'
    --silent
    --fail
    --cookie-jar "$COOKIE_JAR"
    --user "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD"
)
if [[ -n $CA_FILE ]]; then
    cookie_request+=(--cacert "$CA_FILE")
fi
curl "${cookie_request[@]}" "${BASE_URL%/}/" >/dev/null \
    || fail "could not establish the Caddy session cookie"

session_request=(
    --noproxy '*'
    --silent
    --fail
    --cookie "$COOKIE_JAR"
)
if [[ -n $CA_FILE ]]; then
    session_request+=(--cacert "$CA_FILE")
fi
curl "${session_request[@]}" "${BASE_URL%/}/api/health" >/dev/null \
    || fail "session cookie did not authorize an API request"
pass "Caddy session cookie prevents repeated Basic Auth challenges"

vela_request=(
    --noproxy '*'
    --silent
    --fail
    --user "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD"
)
if [[ -n $CA_FILE ]]; then
    vela_request+=(--cacert "$CA_FILE")
fi
vela_status=$(curl "${vela_request[@]}" "${BASE_URL%/}/api/integrations/vela/status") \
    || fail "local-agent compatibility status request failed"
[[ $vela_status == '{}' ]] || fail "local-agent compatibility status was not neutral"
pass "local-agent mode bypasses the unavailable AMR login gate"

amr_models=$(curl "${vela_request[@]}" "${BASE_URL%/}/api/amr/models") \
    || fail "local-agent AMR model compatibility request failed"
[[ $amr_models == '{"source":"preset","models":[],"refreshing":false}' ]] \
    || fail "local-agent AMR model compatibility response was invalid"
pass "local-agent mode suppresses unavailable AMR model probing"

runtime_uid=$(compose exec -T open-design id -u 2>/dev/null) || fail "could not execute id in open-design"
[[ $runtime_uid =~ ^[0-9]+$ ]] || fail "open-design returned an invalid runtime UID"
[[ $runtime_uid != 0 ]] || fail "open-design runs as root"
pass "open-design runtime UID is non-root"

app_config=$(compose exec -T open-design node -e \
    "fetch('http://127.0.0.1:7456/api/app-config').then(r => r.json()).then(x => process.stdout.write(String(x.config?.agentId) + ':' + String(x.config?.onboardingCompleted)))" \
    2>/dev/null) || fail "could not read Open Design app configuration"
[[ $app_config == 'opencode:true' ]] || fail "Open Design did not initialize with OpenCode"
pass "Open Design bypasses AMR onboarding and defaults to OpenCode"

opencode_version=$(compose exec -T open-design opencode --version 2>/dev/null) || fail "opencode version command failed"
codex_version=$(compose exec -T open-design codex --version 2>/dev/null) || fail "codex version command failed"
claude_version=$(compose exec -T open-design claude --version 2>/dev/null) || fail "claude version command failed"

[[ $opencode_version == '1.18.18' ]] || fail "opencode version does not match the required pin"
[[ $codex_version == 'codex-cli 0.147.0' ]] || fail "codex version does not match the required pin"
[[ $claude_version == '2.1.233 (Claude Code)' ]] || fail "claude version does not match the required pin"
pass "opencode, codex, and claude execute at the exact pinned versions"

if [[ $CHECK_PERSISTENCE == 1 ]]; then
    marker="smoke-$PPID-$(date +%s)"
    state_marker="/app/.od/.${marker}"
    home_marker="/home/open-design/.${marker}"

    cleanup_markers() {
        compose exec -T open-design rm -f "$state_marker" "$home_marker" >/dev/null 2>&1 || true
    }
    trap 'cleanup_markers; rm -f "$COOKIE_JAR"' EXIT

    compose exec -T open-design sh -c 'printf "%s\n" "$1" > "$2"; printf "%s\n" "$1" > "$3"' sh "$marker" "$state_marker" "$home_marker" >/dev/null \
        || fail "could not write persistence markers"

    compose up -d --no-deps --force-recreate open-design >/dev/null \
        || fail "could not force-recreate open-design"
    wait_for_healthy || fail "force-recreated open-design did not become healthy within the bounded wait"

    state_value=$(compose exec -T open-design sh -c 'cat "$1"' sh "$state_marker" 2>/dev/null) \
        || fail "state marker did not persist"
    home_value=$(compose exec -T open-design sh -c 'cat "$1"' sh "$home_marker" 2>/dev/null) \
        || fail "home marker did not persist"
    [[ $state_value == "$marker" ]] || fail "state marker changed during recreation"
    [[ $home_value == "$marker" ]] || fail "home marker changed during recreation"

    cleanup_markers
    trap 'rm -f "$COOKIE_JAR"' EXIT
    pass "Open Design state and home data persist across force recreation"
fi

printf 'Smoke verification completed successfully.\n'
