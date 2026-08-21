# Open Design behind Caddy

This deployment runs Open Design behind Caddy HTTPS and browser Basic Auth. Open Design is private to the Compose network; only Caddy publishes host ports.

On first startup, a one-shot initializer skips Open Design's optional AMR/Vela onboarding and selects the bundled OpenCode CLI. It only fills missing preferences, so changing the selected agent to Codex or Claude Code in Open Design is preserved on later restarts. Vela is not required for this deployment.

The upstream web UI currently redirects definitively signed-out AMR users back to cloud onboarding even when a local CLI is selected. Caddy therefore returns a neutral status for the UI's `/api/integrations/vela/status` probe after authentication and an empty, contract-valid response for its unconditional `/api/amr/models` probe. This keeps the self-hosted Home surface available without claiming an AMR login. The visible Open Design Cloud **Sign in** action is optional and deliberately returns a clear disabled response; it does not affect OpenCode, Codex, or Claude. This deployment does not provide an AMR account, credentials, models, or access to Open Design Cloud. All other requests continue to Open Design normally.

## Security model

- Caddy authenticates every request and removes the Basic `Authorization` header before proxying it.
- Basic Auth has no reliable logout, MFA, account recovery, or built-in rate limiting. Closing all browser windows may clear cached credentials, but do not rely on that as logout.
- Open Design agents and their installed CLIs have high authority: they can read and change persisted project and credential data and can call configured providers. Give access only to trusted operators, review agent actions, and use least-privilege provider accounts and keys.
- Never commit `.env.local`, `.env.prod`, provider credentials, CLI login state, the local CA private key, or backups.

## Create credentials

Copy the appropriate example first:

```sh
cp .env.local.example .env.local
cp .env.prod.example .env.prod
```

Generate a bcrypt hash interactively. This command prompts for the password, so plaintext is not placed in shell arguments or history:

```sh
docker run --rm -it caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 caddy hash-password
```

Set `BASIC_AUTH_USER` and store only the generated hash in `BASIC_AUTH_HASH`. In a Compose env file, wrap the hash in single quotes, for example `BASIC_AUTH_HASH='<bcrypt-hash>'`; this preserves bcrypt dollar signs literally. Do not use an unquoted or double-quoted hash, do not replace `$` with `$$`, and do not store the plaintext password.

Generate the shared Caddy session token and store it in `SESSION_TOKEN`:

```sh
openssl rand -hex 32
```

After the first successful Basic Auth challenge, Caddy stores this value in a one-week `Secure`, `HttpOnly`, `SameSite=Strict` cookie. This avoids repeated browser prompts from parallel API requests that omit cached Basic credentials. Rotate `SESSION_TOKEN` to invalidate every browser session.

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are optional. Leave unused keys empty. Production also requires `DESIGN_DOMAIN` as a hostname only, without a scheme or path.

## Local operation

Complete the configuration lane before starting anything:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml config --quiet
```

Validate Caddy separately without starting its dependencies:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

After it succeeds, build and start the local stack:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build
```

Open `https://design.localhost`. The special `.localhost` suffix resolves to the local machine without a hosts-file entry. The local stack binds to loopback, so it is not a LAN endpoint. The browser will reject Caddy's private CA until that CA is trusted.

Extract the public root certificate from the running local Caddy container. Keep the Caddy data volume private because it also contains the CA private key.

```sh
docker cp "$(docker compose --env-file .env.local -f docker-compose.local.yml ps -q caddy)":/data/caddy/pki/authorities/local/root.crt ./root.crt
```

Record the certificate's SHA-256 fingerprint before trusting it, and retain the fingerprint until removal:

```sh
openssl x509 -in root.crt -noout -fingerprint -sha256
```

Trust and remove that exact certificate using the mechanism for the workstation:

| Platform | Trust | Remove |
| --- | --- | --- |
| Debian/Ubuntu | `sudo cp root.crt /usr/local/share/ca-certificates/open-design-local.crt && sudo update-ca-certificates` | `sudo rm /usr/local/share/ca-certificates/open-design-local.crt && sudo update-ca-certificates` |
| Fedora/RHEL | `sudo cp root.crt /etc/pki/ca-trust/source/anchors/open-design-local.crt && sudo update-ca-trust` | `sudo rm /etc/pki/ca-trust/source/anchors/open-design-local.crt && sudo update-ca-trust` |
| macOS | `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root.crt` | Verify the recorded SHA-256 fingerprint, then use `sudo security delete-certificate -Z '<SHA-256-without-colons>' /Library/Keychains/System.keychain`. |
| Windows (Administrator PowerShell) | Record both `certutil -dump .\root.crt` output and the certificate thumbprint, then run `certutil -addstore -f Root .\root.crt`. | Verify the recorded SHA-256 value, then run `certutil -delstore Root "<recorded-thumbprint>"`; do not delete by display name alone. |

Firefox may use its own certificate store depending on policy and version; import or remove the certificate there if system trust is not honored. Match the recorded SHA-256 fingerprint before removing any certificate. Delete the extracted `root.crt` after trust setup.

Normal shutdown preserves volumes and the local CA:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml down
```

`down -v` deletes the persisted Open Design data, agent home, and Caddy data. The next startup creates a different local CA, so remove the old trust entry, start the stack, extract the new root, and trust it again:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml down -v
```

## Production operation

Before startup, point public DNS `A` and/or `AAAA` records for `DESIGN_DOMAIN` at the server. Permit inbound TCP 80 and 443 for ACME and HTTPS, and UDP 443 for HTTP/3, through every host and network firewall. The host and containers also need outbound DNS and HTTPS access for certificate issuance, image downloads, provider APIs, and CLI login. Do not publish Open Design's application port.

### Deploy to a Droplet without Git

The local deployment script installs Docker Engine, Buildx, and the Compose plugin on an x86_64 Ubuntu/Debian Droplet, copies only the required production files over SSH, validates the configuration, builds the image, and waits for Open Design, its initializer, and Caddy to become ready. It does not require Git on the VM host or perform a remote repository checkout; the Open Design container still includes Git because local coding agents use it at runtime.

Prepare the production environment locally first:

```sh
cp .env.prod.example .env.prod
docker run --rm -it caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 caddy hash-password
openssl rand -hex 32
```

Fill `DESIGN_DOMAIN`, `BASIC_AUTH_USER`, `BASIC_AUTH_HASH`, and `SESSION_TOKEN` in `.env.prod`. Then deploy using the Droplet's SSH user and address:

Restrict the local environment file before it is transferred:

```sh
chmod 600 .env.prod
```

Before the first deployment, verify the Droplet's SSH host-key fingerprint through the DigitalOcean console and connect once with `ssh root@203.0.113.10` to store that verified key in `known_hosts`. The deployment script uses strict host-key checking and will not trust an unknown or changed key automatically.

```sh
scripts/deploy-droplet.sh root@203.0.113.10
```

For a non-root SSH account, configure passwordless sudo and confirm `sudo -n true` succeeds. The remote directory must be one dedicated `/opt/<name>` path:

```sh
scripts/deploy-droplet.sh deploy@203.0.113.10 /opt/aztech-open-design
```

Set `SSH_PORT` when SSH is not listening on port 22. Re-running the script is an in-place update and preserves all Docker volumes:

```sh
SSH_PORT=2222 scripts/deploy-droplet.sh deploy@203.0.113.10
```

When the Droplet uses a dedicated SSH key, pass it with `--ssh-key` (or `-i`):

```sh
scripts/deploy-droplet.sh --ssh-key ~/.ssh/dio_dev_droplet root@165.22.71.197
```

The `SSH_KEY` environment variable remains available for automation.

The encrypted SSH stream includes `.env.prod`. It is first stored in a mode-`0600` temporary archive, extracted into a root-only staging directory, and atomically installed as a root-owned mode-`0600` file. The script intentionally excludes local Compose files, `.env.local`, tests, plans, Git metadata, browser artifacts, and other development-only content.

Manual maintenance on the VM uses root privileges because the deployment directory and environment file are root-owned:

```sh
cd /opt/aztech-open-design
sudo docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

Validate before starting:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet
```

Validate Caddy separately without starting its dependencies:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Then build and start:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Stop without deleting persistent data:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

Caddy obtains and renews the public certificate automatically when DNS and inbound connectivity are correct.

When the Workspace Manager is deployed on the same Droplet, use the root `scripts/deploy-droplet.sh` unified deployment instead of this project-level production script. Both project-level production Compose files include standalone Caddy services and cannot publish ports 80/443 simultaneously.

## Provider access and persistence

Provider keys supplied in the env file are available to the agents. Prefer scoped keys with spending limits. As an alternative, enter the container and use each provider CLI's interactive login; never put login secrets on command lines:

```sh
docker compose --env-file .env.local -f docker-compose.local.yml exec open-design sh
```

Use the corresponding production Compose prefix for production. CLI login state and agent configuration survive container replacement because `/home/open-design` is persistent. Open Design state survives in `/app/.od`.

## Backups and upgrades

Back up `/app/.od`, `/home/open-design`, and Caddy's `/data` and `/config` volumes. These contain sensitive project data, login credentials, private keys, and ACME account state. Use a cold backup so no service writes while the archive is created.

For the local stack:

```sh
umask 077
docker compose --env-file .env.local -f docker-compose.local.yml down
docker run --rm -v aztech-open-design-local-state:/source/app-od:ro -v aztech-open-design-local-home:/source/home:ro -v aztech-open-design-local-caddy-data:/source/caddy-data:ro -v aztech-open-design-local-caddy-config:/source/caddy-config:ro -v "$PWD:/backup" alpine:3.22.1 sh -c 'umask 077 && tar -C /source -czf /backup/open-design-backup-local.tgz app-od home caddy-data caddy-config'
docker compose --env-file .env.local -f docker-compose.local.yml up -d
```

For the production stack:

```sh
umask 077
docker compose --env-file .env.prod -f docker-compose.prod.yml down
docker run --rm -v aztech-open-design-prod-state:/source/app-od:ro -v aztech-open-design-prod-home:/source/home:ro -v aztech-open-design-prod-caddy-data:/source/caddy-data:ro -v aztech-open-design-prod-caddy-config:/source/caddy-config:ro -v "$PWD:/backup" alpine:3.22.1 sh -c 'umask 077 && tar -C /source -czf /backup/open-design-backup-prod.tgz app-od home caddy-data caddy-config'
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

If a backup command fails, restart the stopped stack after investigating; do not leave production offline unintentionally. Encrypt and restrict the archive, test restoration separately, and retain it outside the Docker host. Losing Caddy data forces certificate and ACME account reissuance and can encounter certificate-authority rate limits. Before changing pinned image or CLI versions, take a backup, rebuild with the same production command, verify access and agent tooling, and retain the prior image and backup for rollback. Never use `down -v` during a routine upgrade.
