import "server-only"
import type {
  ApiServices,
  GithubService,
  GitService,
  OpenCodeService,
  SessionRepoService,
  WorkspaceRepoService,
} from "./services"
import { getApiServices } from "./services"
import {
  createWorkspaceSchema,
  nameSchema,
  ownerSchema,
  parseBody,
  parseSearchParams,
  promptSchema,
  searchRepositoriesSchema,
  sessionIdSchema,
  workspaceIdSchema,
} from "./validation"
import { apiError, mapServiceError, notFound, ok, upstream } from "./http"
import { createEventStreamResponse, filterSessionEvents } from "./eventRelay"
import { buildOpenCodeWebUrl } from "../opencode/web-url"

export interface RouteServices {
  workspaceRepo: WorkspaceRepoService
  sessionRepo: SessionRepoService
  github: GithubService
  git: GitService
  opencode: OpenCodeService
}

function fullServices(services: Partial<RouteServices>): RouteServices {
  const defaults: ApiServices = getApiServices()
  return {
    workspaceRepo: services.workspaceRepo ?? defaults.workspaceRepo,
    sessionRepo: services.sessionRepo ?? defaults.sessionRepo,
    github: services.github ?? defaults.github,
    git: services.git ?? defaults.git,
    opencode: services.opencode ?? defaults.opencode,
  }
}

type RouteParams = Record<string, string | undefined>

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

function extractRepository(repository: string): { owner: string; name: string } {
  const [owner = "", name = ""] = repository.split("/")
  return { owner, name }
}

function badParam(message: string): Response {
  return apiError("bad-request", message, 400)
}

async function wrap<T>(call: () => Promise<T>): Promise<Response> {
  try {
    const value = await call()
    return typeof value === "object" && value instanceof Response ? value : ok(value)
  } catch (error) {
    return mapServiceError(error) ?? upstream(`Unexpected server error: ${String(error)}`)
  }
}

export async function listWorkspaces(
  request: Request,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  return wrap(async () => {
    const workspaces = await s.workspaceRepo.list()
    return { workspaces }
  })
}

export async function createWorkspace(
  request: Request,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const body = await readJson(request)
  const parsed = parseBody(createWorkspaceSchema, body)
  if (!parsed.ok) {
    return parsed.response
  }
  const { branch } = parsed.value
  const { owner, name } = extractRepository(parsed.value.repository)
  const sshUrl = `git@github.com:${owner}/${name}.git`
  return wrap(async () => {
    const directory = await s.git.clone({ owner, repo: name, branch, sshUrl })
    const workspace = await s.workspaceRepo.create({
      repository: parsed.value.repository,
      branch,
      directory,
    })
    return { workspace }
  })
}

export async function getWorkspace(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  return wrap(async () => {
    const workspace = await s.workspaceRepo.get(id.data)
    if (workspace === null) {
      return notFound("workspace not found")
    }
    return { workspace }
  })
}

export async function listSessions(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  return wrap(async () => {
    const workspace = await s.workspaceRepo.get(id.data)
    if (workspace === null) {
      return notFound("workspace not found")
    }
    const openCodeSessions = await s.opencode.listSessions(workspace.directory)
    const sessions = await Promise.all(
      openCodeSessions.map((session) =>
        s.sessionRepo.upsert({
          id: session.id,
          workspaceID: id.data,
          directory: workspace.directory,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }),
      ),
    )
    const openCodeSessionIDs = new Set(openCodeSessions.map((session) => session.id))
    const storedSessions = await s.sessionRepo.listByWorkspace(id.data)
    await Promise.all(
      storedSessions
        .filter((session) => !openCodeSessionIDs.has(session.id))
        .map((session) => s.sessionRepo.delete(session.id)),
    )
    const lastSessionID =
      workspace.lastSessionID !== null && openCodeSessionIDs.has(workspace.lastSessionID)
        ? workspace.lastSessionID
        : (openCodeSessions[0]?.id ?? null)
    const updatedWorkspace =
      lastSessionID === workspace.lastSessionID
        ? workspace
        : await s.workspaceRepo.updateLastSession(id.data, lastSessionID)
    return { workspace: updatedWorkspace ?? workspace, sessions, lastSessionID }
  })
}

export async function createSession(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  const body = await readJson(request)
  const title = typeof body === "object" && body !== null ? (body as { title?: unknown }).title : undefined
  return wrap(async () => {
    const workspace = await s.workspaceRepo.get(id.data)
    if (workspace === null) {
      return notFound("workspace not found")
    }
    const session = await s.opencode.createSession(workspace.directory, typeof title === "string" ? title : undefined)
    await s.sessionRepo.upsert({
      id: session.id,
      workspaceID: id.data,
      directory: workspace.directory,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    const updated = await s.workspaceRepo.updateLastSession(id.data, session.id)
    return { session, workspace: updated, openCodeUrl: buildOpenCodeWebUrl(workspace.directory, session.id) }
  })
}

export async function activateSession(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  const sessionId = sessionIdSchema.safeParse(params["sessionId"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  if (!sessionId.success) {
    return badParam("malformed session id")
  }
  return wrap(async () => {
    const workspace = await s.workspaceRepo.get(id.data)
    if (workspace === null) {
      return notFound("workspace not found")
    }
    const mapping = await s.sessionRepo.get(sessionId.data)
    if (mapping === null) {
      return notFound("session not found")
    }
    await s.workspaceRepo.updateLastSession(id.data, sessionId.data)
    return { ok: true, lastSessionID: sessionId.data }
  })
}

export async function listMessages(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  const sessionId = sessionIdSchema.safeParse(params["sessionId"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  if (!sessionId.success) {
    return badParam("malformed session id")
  }
  return wrap(async () => {
    const mapping = await s.sessionRepo.get(sessionId.data)
    if (mapping === null) {
      return notFound("session not found")
    }
    const messages = await s.opencode.listMessages(sessionId.data, mapping.directory)
    return { messages }
  })
}

export async function submitPrompt(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const id = workspaceIdSchema.safeParse(params["id"])
  const sessionId = sessionIdSchema.safeParse(params["sessionId"])
  if (!id.success) {
    return badParam("malformed workspace id")
  }
  if (!sessionId.success) {
    return badParam("malformed session id")
  }
  const body = await readJson(request)
  const parsed = parseBody(promptSchema, body)
  if (!parsed.ok) {
    return parsed.response
  }
  return wrap(async () => {
    const mapping = await s.sessionRepo.get(sessionId.data)
    if (mapping === null) {
      return notFound("session not found")
    }
    await s.opencode.promptAsync(sessionId.data, mapping.directory, parsed.value.text)
    return { ok: true, sessionID: sessionId.data }
  })
}

export async function streamSessionEvents(
  request: Request,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const url = new URL(request.url)
  const sessionId = sessionIdSchema.safeParse(url.searchParams.get("sessionId") ?? undefined)
  if (!sessionId.success) {
    return badParam("malformed session id")
  }
  return wrap(async () => {
    const mapping = await s.sessionRepo.get(sessionId.data)
    if (mapping === null) {
      return notFound("session not found")
    }
    const source = s.opencode.subscribeEvents(mapping.directory, request.signal)
    return createEventStreamResponse(filterSessionEvents(source, sessionId.data), {
      signal: request.signal,
      log: (message) => console.log(`[events] ${message}`),
    })
  })
}

export async function searchRepositories(
  request: Request,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const url = new URL(request.url)
  const parsed = parseSearchParams(searchRepositoriesSchema, url)
  if (!parsed.ok) {
    return parsed.response
  }
  return wrap(async () => {
    const result = await s.github.searchRepositories(parsed.value.q, parsed.value.limit ?? 10)
    return { repositories: result.repositories, totalCount: result.totalCount }
  })
}

export async function listBranches(
  request: Request,
  params: RouteParams,
  services: Partial<RouteServices> = {},
): Promise<Response> {
  const s = fullServices(services)
  const owner = ownerSchema.safeParse(params["owner"])
  const name = nameSchema.safeParse(params["repo"])
  if (!owner.success) {
    return badParam("malformed GitHub owner")
  }
  if (!name.success) {
    return badParam("malformed GitHub repository name")
  }
  return wrap(async () => {
    const branches = await s.github.listBranches(owner.data, name.data)
    return { branches }
  })
}
