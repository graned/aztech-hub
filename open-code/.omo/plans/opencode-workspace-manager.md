# opencode-workspace-manager - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A self-hosted single-user coding workspace manager with a local Docker Compose stack you can verify at `http://coding.localhost`, plus a production Compose stack for `coding.aztech-hub.com`. It will browse GitHub repositories, clone validated workspaces, create/resume OpenCode sessions, stream prompts/events through Next.js, and persist only lightweight mappings in MongoDB.

**Why this approach:** OpenCode stays the source of truth for coding sessions and conversation state, while Next.js owns the browser/API boundary and MongoDB owns only workspace/session indexes. Local Compose is the acceptance baseline, so private networking and persistence are verified before feature expansion.

**What it will NOT do:** It will not expose OpenCode or MongoDB publicly, duplicate OpenCode conversation storage, or add multi-user SaaS infrastructure. It will not use OpenCode Web or a public OpenCode hostname.

**Effort:** XL
**Risk:** High - OpenCode SDK/server versions and long-lived event streaming must be verified against the pinned runtime.
**Decisions I made for you:** pnpm plus Node in Docker, official MongoDB driver, local HTTP Caddy, production Caddy Basic Auth, and a gateway that can adapt the verified OpenCode API generation without leaking it into UI code.

Your next move: Execute the first infrastructure and OpenCode vertical-slice task, then continue through the dependent tasks.

---

> TL;DR (machine): XL/high-risk build delivering local-first Docker infrastructure, OpenCode gateway, GitHub/workspaces/session UI, persistence, SSE relay, tests, and production deployment docs.

## Scope
### Must have
* All Browser-to-OpenCode traffic flows through Next.js; the browser never sees `OPENCODE_URL`.
* Local Compose includes app, mongodb, opencode, and caddy, with hot reload and persistent volumes.
* Production Compose publishes only Caddy ports 80/443.
* Shared `/workspaces` path exists identically in app and OpenCode containers.
* Health, GitHub, workspace, session, prompt, activation, and event routes use Zod at boundaries.
* Real local verification covers health, repository/workspace flow where credentials exist, session creation, prompt submission, switching, and persistence.
### Must NOT have (guardrails, anti-slop, scope boundaries)
* No public OpenCode route, public MongoDB route, published app port, Docker socket, shell interpolation, OAuth, multi-user schema, or duplicated OpenCode message store.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Vitest for pure logic, HTTP-level integration fakes for GitHub/OpenCode, MongoDB integration where available, and Playwright E2E against the local Compose stack.
- Evidence: .omo/evidence/task-<N>-opencode-workspace-manager.<ext>

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
* Wave 1: bootstrap files/design system, Docker/Caddy, OpenCode contract/gateway tests.
* Wave 2: MongoDB repositories, GitHub adapter, Git workspace manager.
* Wave 3: API routes and dashboard/workspace/session UI.
* Wave 4: coding interface and SSE relay.
* Wave 5: production hardening, README, full local E2E and browser QA.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2,3,4 | 2 |
| 2 | 1 | 5,6 | 3,4 |
| 3 | 1 | 5,6 | 2,4 |
| 4 | 1 | 5,6 | 2,3 |
| 5 | 2,3,4 | 6,7 | 6 |
| 6 | 1,5 | 7 | 7 |
| 7 | 5,6 | 8 | 8 |
| 8 | 1,7 | final | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence .omo/evidence/task-1-opencode-workspace-manager.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>
- [ ] 1. Bootstrap the strict Next.js project and design system
  What to do / Must NOT do: Create package configuration, strict TypeScript, ESLint, Vitest, Tailwind/shadcn foundations, `DESIGN.md`, root layout, and a minimal health-capable app shell. Do not build feature UI before documenting tokens.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2,5,6 | Can parallelize with: 2
  References (executor has NO interview context - be exhaustive): `package.json`, `tsconfig.json`, `next.config.*`, `src/app`, `DESIGN.md`, Next App Router docs, TypeScript strict reference.
  Acceptance criteria (agent-executable): `pnpm install --frozen-lockfile` succeeds; `pnpm typecheck`, `pnpm lint`, and `pnpm test` succeed; `next build` succeeds; `DESIGN.md` has all seven required sections.
  QA scenarios (name the exact tool + invocation): happy `pnpm dev` then `curl -i http://localhost:3000/api/health`; failure `pnpm typecheck` rejects a deliberately malformed route fixture without changing product files. Evidence `.omo/evidence/task-1-opencode-workspace-manager.txt`.
  Commit: Y | `feat(bootstrap): scaffold strict Next.js workspace manager`
- [ ] 2. Build local and production Docker networking
  What to do / Must NOT do: Add multi-stage Dockerfile, both Compose files, Caddyfiles, env example, ignore rules, healthchecks, restart policies, persistent volumes, shared `/workspaces`, and local hot reload. Do not publish app, MongoDB, or OpenCode ports.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 8 | Can parallelize with: 3,4
  References (executor has NO interview context - be exhaustive): `Dockerfile`, `docker-compose.local.yml`, `docker-compose.prod.yml`, `Caddyfile.local`, `Caddyfile.prod`, `.env.example`, sibling `open-design/docker-compose*.yml` as reference only, Next standalone Docker docs.
  Acceptance criteria (agent-executable): `docker compose -f docker-compose.local.yml --env-file .env.example config` and production config succeed; config output has only Caddy host ports; app/opencode/mongodb share the same workspace volume and dedicated network.
  QA scenarios (name the exact tool + invocation): happy `docker compose -f docker-compose.local.yml up -d --build` then `curl -i http://coding.localhost/api/health`; failure `docker compose -f docker-compose.prod.yml config` fails when required production domain/auth variables are absent. Evidence `.omo/evidence/task-2-opencode-workspace-manager.txt`.
  Commit: Y | `feat(infra): add private local and production Compose stacks`
- [ ] 3. Verify and implement the OpenCode gateway
  What to do / Must NOT do: Inspect installed SDK types and pinned server OpenAPI first, then implement server-only client/gateway/mapper/types for health, projects/directories, sessions, messages, prompts, and events. Do not let React components instantiate SDK clients or assume undocumented payloads.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 5,7 | Can parallelize with: 2,4
  References (executor has NO interview context - be exhaustive): `src/lib/opencode/*`, `@opencode-ai/sdk` installed source, OpenCode server OpenAPI, SDK event/session resources, `OPENCODE_URL` environment contract.
  Acceptance criteria (agent-executable): gateway tests pass against an HTTP fixture matching the verified API; health/session/message/prompt/event methods compile with no `any`; missing/invalid upstream responses become typed errors.
  QA scenarios (name the exact tool + invocation): happy `pnpm test -- opencode` proves session creation and prompt mapping; failure fixture returns malformed upstream JSON and the gateway returns a typed integration error. Evidence `.omo/evidence/task-3-opencode-workspace-manager.txt`.
  Commit: Y | `feat(opencode): add verified server-only gateway`
- [ ] 4. Implement MongoDB metadata persistence
  What to do / Must NOT do: Add Mongo singleton, health ping, workspace repository, session mapping repository, typed documents, and indexes. Do not persist OpenCode messages, parts, prompts, or tool output.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 5,6 | Can parallelize with: 2,3
  References (executor has NO interview context - be exhaustive): `src/lib/mongodb/*`, workspace domain types, official MongoDB Node driver connection/index docs.
  Acceptance criteria (agent-executable): repository tests cover create/list/get/delete, unique repository-branch-directory constraints, last-session updates, and health ping; document types contain no conversation fields.
  QA scenarios (name the exact tool + invocation): happy `pnpm test -- mongodb` runs against a Mongo test container or explicit HTTP-free repository fake; failure duplicate workspace insertion returns a typed conflict. Evidence `.omo/evidence/task-4-opencode-workspace-manager.txt`.
  Commit: Y | `feat(storage): persist workspace and session mappings`
- [ ] 5. Add GitHub adapter and safe Git workspace manager
  What to do / Must NOT do: Implement server-only GitHub repository/branch client and `src/lib/git/workspace-manager.ts` using argv-based spawn, SSH clone URLs, path containment, branch validation, status, and lifecycle errors. Never interpolate shell commands or copy private keys into images.
  Parallelization: Wave 2 | Blocked by: 3,4 | Blocks: 6 | Can parallelize with: none
  References (executor has NO interview context - be exhaustive): `src/lib/github/*`, `src/lib/git/*`, GitHub REST API docs, workspace model, `WORKSPACE_ROOT`, SSH runtime mounts.
  Acceptance criteria (agent-executable): unit tests reject traversal and invalid identifiers; Git tests assert exact argv arrays; adapter tests cover repository search, branches, invalid token, clone failure, existing directory, and status.
  QA scenarios (name the exact tool + invocation): happy with a test fixture `pnpm test -- github git`; failure path input `../../outside` is rejected and no process is spawned. Evidence `.omo/evidence/task-5-opencode-workspace-manager.txt`.
  Commit: Y | `feat(workspaces): add GitHub browsing and safe clone lifecycle`
- [x] 6. Add API routes and workspace/session navigation UI
  What to do / Must NOT do: Add validated routes for health, GitHub, workspaces, sessions, session activation, and messages; build responsive dashboard, creation flow, workspace view, session list, status/empty/loading/error states, and last-active restoration. Keep OpenCode calls behind services.
  Parallelization: Wave 3 | Blocked by: 4,5 | Blocks: 7 | Can parallelize with: none
  References (executor has NO interview context - be exhaustive): `src/app/api`, `src/app/workspaces`, `src/components`, `DESIGN.md`, workspace/session services, route-handler validation conventions.
  Acceptance criteria (agent-executable): route tests reject malformed IDs/body payloads; UI has keyboard-accessible controls and mobile layouts; switching workspace/session updates URL/state and restores the stored last session.
  QA scenarios (name the exact tool + invocation): happy Playwright opens dashboard, creates/selects a session, switches workspace, and returns to the original session; failure API sends malformed workspace payload and receives a structured 400. Evidence `.omo/evidence/task-6-opencode-workspace-manager.txt`.
  Commit: Y | `feat(ui): add workspace and session navigation`
- [x] 7. Add coding interface and OpenCode event relay
  What to do / Must NOT do: Implement conversation rendering, prompt submission, tool/activity states, and Next.js SSE relay with upstream cancellation and event filtering. Browser code must call only Next.js routes.
  Parallelization: Wave 4 | Blocked by: 3,6 | Blocks: 8 | Can parallelize with: none
  References (executor has NO interview context - be exhaustive): `src/app/api/workspaces/[id]/sessions/[sessionId]/messages`, `src/app/api/events`, `src/components/conversation`, verified OpenCode event schema, Next streaming Route Handler docs.
  Acceptance criteria (agent-executable): prompt route returns typed success/error; SSE route emits validated event envelopes and closes on AbortSignal; browser source contains no `OPENCODE_URL` or `opencode:4096`.
  QA scenarios (name the exact tool + invocation): happy Playwright sends a prompt and observes assistant/activity updates through Next.js; failure disconnects the SSE client with `curl --no-buffer` and confirms upstream cancellation/logged cleanup. Evidence `.omo/evidence/task-7-opencode-workspace-manager.txt`.
  Commit: Y | `feat(conversation): add prompt UI and private event relay`
- [x] 8. Finish diagnostics, production hardening, README, and local E2E
  What to do / Must NOT do: Add settings diagnostics, production Caddy Basic Auth, deployment/persistence/SSH documentation, backup guidance, and full local Compose verification. Do not claim GitHub/OpenCode success when credentials or containers are unavailable; show honest failure states.
  Parallelization: Wave 5 | Blocked by: 2,7 | Blocks: final | Can parallelize with: none
  References (executor has NO interview context - be exhaustive): `README.md`, settings route/page, both Compose files, both Caddyfiles, `.env.example`, all API and E2E tests.
  Acceptance criteria (agent-executable): README documents local and production commands, DNS, no OpenCode DNS, SSH mounts, volumes, backups, and troubleshooting; local stack starts; `curl -i http://coding.localhost/api/health` reports service states; production config publishes only 80/443.
  QA scenarios (name the exact tool + invocation): happy Playwright runs the complete local definition-of-done path with test credentials/fakes; failure stops OpenCode and verifies the UI/API report disconnected without exposing internal addresses. Evidence `.omo/evidence/task-8-opencode-workspace-manager.txt`.
  Commit: Y | `docs(ops): document local verification and production deployment`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
Use one focused commit per todo. Never commit `.env.local`, `.env.prod`, SSH keys, Caddy private CA material, Mongo/OpenCode volumes, browser artifacts, or `.codegraph` database files.

## Success criteria
* `docker compose.local.yml` starts app, MongoDB, OpenCode, and Caddy with persistent volumes and no public internal ports.
* Browser health and session flow work through `coding.localhost`.
* GitHub repositories/branches can be selected and cloned into `/workspaces` when credentials are configured.
* Workspace/session mappings survive restart while OpenCode remains canonical for conversations.
* Prompt responses and available activity events appear in the browser through Next.js.
* Production Compose/Caddy exposes only `coding.aztech-hub.com` on 80/443.
