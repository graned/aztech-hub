# OpenCode Workspace Manager

Self-hosted, single-user workspace manager paired with the official OpenCode Web UI. Manage GitHub repositories and cloned workspaces at `workspace.aztech-hub.com`, then work in OpenCode at `coding.aztech-hub.com`.

## Architecture

- **Two intentional browser surfaces.** The Workspace Manager owns GitHub browsing, cloning, workspace metadata, and diagnostics. The official OpenCode Web UI owns coding sessions at the coding domain and talks only to the OpenCode service behind Caddy.
- **OpenCode is the source of truth** for sessions, messages, and conversation state. MongoDB stores only lightweight workspace/session indexes (never messages or tool output).
- **No public internal ports.** OpenCode and MongoDB live on a private Compose network. Only Caddy publishes ports 80/443; `coding.aztech-hub.com` is the authenticated public OpenCode Web endpoint.
- The manager's **Open in OpenCode** links use server-generated directory/session deep links and never expose `OPENCODE_URL` or internal container names.

## Local stack

Prerequisites: Docker Engine with Compose v2.

```sh
cp .env.example .env        # optional: local defaults work unchanged
docker compose -f docker-compose.local.yml up -d --build
```

Open http://workspace.localhost for workspace management or http://coding.localhost for the official OpenCode Web UI.

Workspace session cards are OpenCode sessions. Clicking a card opens the official coding UI; **New session** creates the session in OpenCode, records its lightweight MongoDB mapping, and opens that session in the coding UI. Returning to a workspace reconciles sessions created directly in OpenCode Web into MongoDB.

DNS note: both `workspace.localhost` and `coding.localhost` must resolve to `127.0.0.1`. systemd-resolved handles `*.localhost` automatically; otherwise add both names to `/etc/hosts`.

Verify:

```sh
curl -i http://workspace.localhost/api/health
# {"generatedAt":...,"mongodb":{"state":"ok"},"opencode":{"state":"ok"},
#  "github":{"state":"not-configured"},"git":{"state":"ok","root":"/workspaces"}}
```

`github.state` is `not-configured` unless `GITHUB_TOKEN` is set in `.env`.

The app container bind-mounts the source tree for hot reload; dependencies live in the named volume `aztech-opencode-workspace-manager-local-node-modules`. If `package.json` gains dependencies while the stack is running, rebuild: `docker compose -f docker-compose.local.yml up -d --build app`.

## Production

1. Point both `workspace.aztech-hub.com` and `coding.aztech-hub.com` (A/AAAA) at the server. `coding.aztech-hub.com` intentionally serves the official OpenCode Web UI; do not create DNS records for MongoDB or the internal `opencode` service.
2. Create `.env.prod` (never commit it) with every required variable:

   | Variable | Purpose |
   | --- | --- |
   | `WORKSPACE_URL` | Workspace Manager URL, `https://workspace.aztech-hub.com` (Caddy provisions TLS via ACME) |
   | `CODING_URL` | Official OpenCode Web URL, `https://coding.aztech-hub.com` |
   | `MONGODB_URI` | Mongo connection string |
   | `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` | Mongo bootstrap credentials |
   | `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` | OpenCode server basic auth (app-to-OpenCode) |
   | `OPENCODE_BASIC_AUTH` | Base64 of `username:password` for Caddy-to-OpenCode auth; generate with `printf '%s' 'username:password' \| base64 -w0` |
   | `BASIC_AUTH_USERNAME` | Browser basic-auth username (default `admin`) |
   | `BASIC_AUTH_PASSWORD_HASH` | Bcrypt hash: `caddy hash-password --plaintext 'your-password'` |
   | `GITHUB_TOKEN` | Optional; empty disables GitHub browsing |

3. Start the stack:

   ```sh
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```

Only Caddy publishes ports (`80`, `443` tcp/udp). Both public domains are protected by Caddy Basic Auth; the compose file fails closed if any required production variable is missing.

### Deploy to a DigitalOcean Droplet

The repository includes an SSH deployment wrapper modeled after the `open-design` deployment flow. It does not require Git on the Droplet. It installs Docker Engine, Buildx, and the Compose plugin when needed, uploads the production bundle over strict-host-key SSH, installs the production environment and GitHub SSH runtime key with root-only permissions, and starts the stack while waiting for bounded health checks.

Before the first deployment:

1. Create `.env.prod` locally from `.env.example`. Set `WORKSPACE_URL=https://workspace.aztech-hub.com`, `CODING_URL=https://coding.aztech-hub.com`, all required Mongo/OpenCode credentials, `BASIC_AUTH_PASSWORD_HASH`, and `OPENCODE_BASIC_AUTH`.
2. Point both DNS records at the Droplet. Permit inbound TCP `22`, `80`, and `443`, plus UDP `443`; do not publish Docker service ports.
3. Verify the Droplet SSH host fingerprint in the DigitalOcean console, then connect once so it is in your local `known_hosts`.
4. Ensure the local GitHub SSH setup is complete: `./scripts/check-github-ssh.sh owner/repository`.

Deploy as root:

```sh
chmod 600 .env.prod
scripts/deploy-droplet.sh --ssh-key ~/.ssh/digitalocean root@203.0.113.10
```

For a non-root account, configure passwordless sudo first:

```sh
scripts/deploy-droplet.sh deploy@203.0.113.10 /opt/aztech-opencode-workspace-manager
```

The default GitHub key is the one generated by `scripts/setup-github-ssh.sh`. Override it with `--github-key` and `--known-hosts` when needed. Re-running the deployment updates the code and preserves named Docker volumes. The remote reusable setup script is installed at `/opt/aztech-opencode-workspace-manager/scripts/setup-droplet.sh` and can be rerun for a local remote-side rebuild:

```sh
cd /opt/aztech-opencode-workspace-manager
sudo bash scripts/setup-droplet.sh --project-dir /opt/aztech-opencode-workspace-manager
```

The deployment stream includes `.env.prod` and the GitHub private key only over SSH. Neither is included in the source archive or Docker image; the key is mounted read-only into the app container from `runtime-ssh/`.

When `open-design` is deployed on the same Droplet, use the root `scripts/deploy-droplet.sh` unified deployment instead of this project-level production script. Both project-level production Compose files include standalone Caddy services and cannot publish ports 80/443 simultaneously.

## SSH access for private repositories

Cloning uses SSH URLs (`git@github.com:owner/repo.git`). The recommended setup uses a dedicated SSH key attached to your GitHub account. The private key stays on the Docker host and is mounted read-only at runtime; it is never copied into an image or committed.

The setup script intentionally stops before creating a key if the GitHub CLI is not authenticated. Authenticate once, then rerun it:

```sh
gh auth login --web --hostname github.com
./scripts/setup-github-ssh.sh
```

The authenticated `gh` token needs the `admin:public_key` scope so the script can register the public key. If GitHub reports that scope is missing, run `gh auth refresh --hostname github.com --scopes admin:public_key`, then rerun the setup script.

The script generates a dedicated key under `~/.config/opencode-workspace-manager/ssh`, registers only its public key through `gh`, creates `known_hosts` from GitHub's published host keys, and writes non-secret mount paths to `.env.ssh`. It is safe to rerun after authentication or after rotating the key. If your organization uses SSO, authorize the key and token for that organization when GitHub requests it.

Start the local stack with the generated override:

```sh
docker compose --env-file .env --env-file .env.ssh \
  -f docker-compose.local.yml -f docker-compose.ssh.yml \
  up -d --build
```

Use the same override in production, with your production env file:

```sh
docker compose --env-file .env.prod --env-file .env.ssh \
  -f docker-compose.prod.yml -f docker-compose.ssh.yml \
  up -d --build
```

Check account and repository access before cloning:

```sh
./scripts/check-github-ssh.sh owner/repository
```

The optional `owner/repository` argument runs `git ls-remote` and confirms that the authenticated account can read that repository. A GitHub API token is still required separately for repository search and branch browsing; use a fine-grained token where possible and keep it in `.env`, never in browser code.

## Volumes and backups

| Volume (local prefix `aztech-opencode-workspace-manager-local-`, prod prefix `...-prod-`) | Contents | Backup guidance |
| --- | --- | --- |
| `mongo-data` | Workspace/session indexes | `docker compose exec mongodb mongodump --username <user> --password <pass> --authenticationDatabase admin --archive > backup.archive` |
| `workspace-data` | Cloned repositories, shared by app and OpenCode at `/workspaces` | Archive the volume (`docker run --rm -v <volume>:/data alpine tar czf - -C /data .`) or re-clone from GitHub |
| `opencode-data` | OpenCode state, including session/conversation history | Archive the volume to preserve session history |
| `opencode-config` | OpenCode configuration | Small; archive with `opencode-data` |
| `caddy-data` | TLS certificates and ACME state | Archive to avoid rate-limit re-issuance after a rebuild |
| `app-node-modules` (local only) | Dev dependencies | Never back up; recreated by `up -d --build` |

## Troubleshooting

- **Service states:** `GET /api/health` returns per-service diagnostics (`ok`, `unreachable`, `not-configured`); the same states render at `/settings`.
- **Official OpenCode UI unavailable:** open `http://workspace.localhost/api/health`, then check `docker compose -f docker-compose.local.yml ps opencode` and `docker compose logs opencode`. The coding domain is served by the official `opencode web` process.
- **`mongodb` unreachable:** check the `mongodb` container health and `MONGODB_URI` credentials.
- **GitHub features disabled:** set `GITHUB_TOKEN`; the diagnostics show `github.state: not-configured` until then.
- **`Module not found` after adding dependencies:** the app container's node_modules volume is stale; run `docker compose -f docker-compose.local.yml up -d --build app` (recreate the `app-node-modules` volume if it persists).
- **Next cannot find `@swc/helpers/esm` on the Droplet:** redeploy so the production builder copies the complete traced helper package; `scripts/check-standalone-next-runtime.sh aztech-opencode-workspace-manager:prod` verifies the runner image before startup.
- **Open in OpenCode goes to the wrong host:** verify `OPENCODE_WEB_URL`/`CODING_URL` and use the server-generated manager link rather than constructing a coding URL in browser code.
- **Healthcheck unhealthy at startup:** the app and Caddy wait for Mongo and OpenCode health; give dependent containers their `start_period`, then `docker compose ... ps` again.

## Development without Docker

```sh
pnpm install --frozen-lockfile
pnpm dev          # manager development server; needs MONGODB_URI and OPENCODE_URL reachable
pnpm test         # node:test suites; no network required
pnpm typecheck
pnpm lint
pnpm build
```
