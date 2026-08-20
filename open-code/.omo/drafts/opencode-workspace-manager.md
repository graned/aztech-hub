---
slug: opencode-workspace-manager
status: executing
intent: unclear
pending-action: write .omo/plans/opencode-workspace-manager.md
approach: Build a local-first Next.js App Router application with a private OpenCode gateway, MongoDB metadata store, safe GitHub/Git process boundaries, and Docker Compose parity between local and production.
---

# Draft: opencode-workspace-manager

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
| infrastructure | Local and production Compose stacks route only through Caddy | active | .omo/evidence/task-1-opencode-workspace-manager.txt |
| opencode | Server-only gateway proves health, sessions, prompts, and events | active | .omo/evidence/task-2-opencode-workspace-manager.txt |
| persistence | MongoDB stores workspace/session mappings only | active | .omo/evidence/task-3-opencode-workspace-manager.txt |
| github | Server-side repository and branch browsing works | active | .omo/evidence/task-4-opencode-workspace-manager.txt |
| workspaces | Validated clone lifecycle persists ready/error workspace state | active | .omo/evidence/task-5-opencode-workspace-manager.txt |
| ui | Responsive dashboard, workspace, session, and coding screens work | active | .omo/evidence/task-6-opencode-workspace-manager.txt |
| events | Browser receives server-relayed OpenCode events | active | .omo/evidence/task-7-opencode-workspace-manager.txt |
| operations | README, diagnostics, production Caddy, and deployment checks are complete | active | .omo/evidence/task-8-opencode-workspace-manager.txt |

## Open assumptions (announced defaults)
<!-- Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each is surfaced in the plan's human TL;DR for veto. -->
<!-- assumption | adopted default | rationale | reversible? -->
| package manager/runtime | pnpm lockfile with Node runtime in Docker | Matches Next.js standalone deployment and requires no host Node installation | yes |
| database driver | Official MongoDB Node driver | Small mapping database does not need an ORM | yes |
| OpenCode contract | Pin a compatible SDK/server version and adapt behind one gateway | Current docs expose v1/v2 differences; prevents endpoint assumptions leaking into UI | yes |
| local TLS | HTTP at coding.localhost, loopback-bound Caddy ports | Keeps local verification simple; production Caddy owns HTTPS | yes |
| authentication | Production Caddy Basic Auth; local stack unauthenticated by default | Single-user requirement with minimal infrastructure | yes |
| session association | Mongo mapping plus OpenCode directory/workspace filtering when supported | Keeps OpenCode canonical while handling API filtering differences | yes |
| testing | Vitest/unit + HTTP integration + Playwright E2E | Covers boundaries and the real local browser path | yes |

## Findings (cited - path:lines)
* Repository HEAD has no tracked product files; only `.codegraph/.gitignore` is present.
* `@opencode-ai/sdk` docs show client resources for sessions and an event SSE stream, but current OpenCode source also exposes newer generated v2 routes with directory/workspace query routing. The gateway must inspect the pinned package and server OpenAPI before coding.
* Next.js Route Handlers support `ReadableStream` responses suitable for an SSE relay, with disconnect cancellation handled by the Node response pipeline.
* MongoDB's official driver supports a shared `MongoClient`, `admin().ping()`, and normal collection indexes.
* The sibling `open-design` deployment demonstrates Caddy-only published ports, persistent named volumes, and Compose health-gated startup; it is reference material only, not application code.

## Decisions (with rationale)
* Use one Next.js service for UI and API routes; no separate backend.
* Make `/workspaces` the identical mount path in app and OpenCode containers.
* Keep OpenCode, MongoDB, app, and Caddy on one dedicated Compose bridge network; publish only Caddy.
* Use `spawn` with argv arrays for all Git operations and reject paths outside `WORKSPACE_ROOT`.
* Keep conversation/messages/tool history in OpenCode; MongoDB stores metadata and associations only.
* Build local Compose and production Compose together so the local path is the acceptance baseline.

## Scope IN
* Local Docker Compose with hot reload, MongoDB, OpenCode serve, Caddy, shared workspace storage, and persistent data.
* Production Docker Compose with Caddy TLS, Basic Auth, private internal services, and restart/health policies.
* GitHub token repository/branch browsing, SSH-based Git clone support, workspace CRUD, session mapping, session switching, prompt UI, and event relay.
* Strict TypeScript, Zod boundary validation, ESLint, typecheck, unit/integration/E2E tests, and complete README.

## Scope OUT (Must NOT have)
* OpenCode public hostname or published port 4096.
* OpenCode Web, iframe embedding, duplicate message storage, OAuth, multi-user features, Redis, queues, GraphQL, Kubernetes, Terraform, Docker socket access, or a separate backend service.

## Open questions
* Exact OpenCode image tag and SDK API generation are implementation-time verification items, not user decisions; pin the compatible versions after inspecting official package types/OpenAPI.

## Approval gate
status: awaiting-implementation
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
