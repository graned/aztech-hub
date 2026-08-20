import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type {
  GithubService,
  GitService,
  OpenCodeService,
  SessionRepoService,
  WorkspaceRepoService,
} from "../api/services"
import type { RouteServices } from "../api/handlers"
import {
  activateSession,
  createSession,
  createWorkspace,
  getWorkspace,
  listBranches,
  listMessages,
  listSessions,
  listWorkspaces,
  searchRepositories,
  streamSessionEvents,
  submitPrompt,
} from "../api/handlers"
import { GitError, type WorkspaceStatus } from "../git/types"
import { GitHubError } from "../github/types"
import { WorkspaceConflictError, workspaceIdFor, type SessionMappingRecord, type WorkspaceRecord } from "../mongodb/types"
import type { CreateWorkspaceInput } from "../mongodb/workspaceRepo"
import type { UpsertSessionMappingInput } from "../mongodb/sessionRepo"
import type { OpenCodeEventEnvelope, OpenCodeMessage, OpenCodeSession } from "../opencode/types"
import type { GitHubBranch, GitHubRepository } from "../github/types"

const WORKSPACE_ID = "ws-0123456789ab"
const SESSION_ID = "ses-abc123"

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init)
}

function makeJsonRequest(url: string, body: unknown): Request {
  return makeRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: WORKSPACE_ID,
    repository: "octocat/Hello-World",
    branch: "main",
    directory: "/workspaces/octocat/Hello-World",
    createdAt: 1000,
    updatedAt: 1000,
    lastSessionID: null,
    ...overrides,
  }
}

function mapping(overrides: Partial<SessionMappingRecord> = {}): SessionMappingRecord {
  return {
    id: SESSION_ID,
    workspaceID: WORKSPACE_ID,
    directory: workspace().directory,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

const openCodeSession: OpenCodeSession = {
  id: SESSION_ID,
  projectID: "proj",
  directory: workspace().directory,
  title: "Session",
  version: "1",
  createdAt: 1000,
  updatedAt: 1000,
}

const openCodeMessage: OpenCodeMessage = {
  id: "msg-1",
  sessionID: SESSION_ID,
  role: "user",
  createdAt: 1000,
  parts: [],
  model: null,
  agent: null,
  error: null,
}

class FakeWorkspaceRepo implements WorkspaceRepoService {
  records = new Map<string, WorkspaceRecord>()

  async list(): Promise<WorkspaceRecord[]> {
    return [...this.records.values()]
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    return this.records.get(id) ?? null
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    if (this.records.has(workspaceIdFor(input.repository, input.branch, input.directory))) {
      throw new WorkspaceConflictError(input.repository, input.branch, input.directory)
    }
    const record: WorkspaceRecord = {
      id: workspaceIdFor(input.repository, input.branch, input.directory),
      repository: input.repository,
      branch: input.branch,
      directory: input.directory,
      createdAt: 1000,
      updatedAt: 1000,
      lastSessionID: null,
    }
    this.records.set(record.id, record)
    return record
  }

  async updateLastSession(id: string, lastSessionID: string | null): Promise<WorkspaceRecord | null> {
    const record = this.records.get(id)
    if (!record) {
      return null
    }
    const updated = { ...record, lastSessionID, updatedAt: 2000 }
    this.records.set(id, updated)
    return updated
  }
}

class FakeSessionRepo implements SessionRepoService {
  records = new Map<string, SessionMappingRecord>()

  async listByWorkspace(workspaceID: string): Promise<SessionMappingRecord[]> {
    return [...this.records.values()].filter((r) => r.workspaceID === workspaceID)
  }

  async get(id: string): Promise<SessionMappingRecord | null> {
    return this.records.get(id) ?? null
  }

  async upsert(input: UpsertSessionMappingInput): Promise<SessionMappingRecord> {
    const record: SessionMappingRecord = {
      id: input.id,
      workspaceID: input.workspaceID,
      directory: input.directory,
      ...(input.title !== undefined ? { title: input.title } : {}),
      createdAt: 1000,
      updatedAt: 1000,
    }
    this.records.set(record.id, record)
    return record
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id)
  }
}

class FakeGit implements GitService {
  cloned: Array<{ owner: string; repo: string; branch: string; sshUrl: string }> = []
  error: GitError | null = null
  directory = "/workspaces/octocat/Hello-World"

  async clone(options: { owner: string; repo: string; branch: string; sshUrl: string }): Promise<string> {
    if (this.error) {
      throw this.error
    }
    this.cloned.push(options)
    return this.directory
  }

  async status(_directory: string): Promise<WorkspaceStatus> {
    return { branch: "main", clean: true, ahead: 0, behind: 0 }
  }
}

class FakeGithub implements GithubService {
  repositories: GitHubRepository[] = []
  branches: GitHubBranch[] = []
  error: GitHubError | null = null

  async searchRepositories(_query: string, _limit?: number) {
    if (this.error) {
      throw this.error
    }
    return { repositories: this.repositories, totalCount: this.repositories.length }
  }

  async listBranches(_owner: string, _repo: string): Promise<GitHubBranch[]> {
    if (this.error) {
      throw this.error
    }
    return this.branches
  }

  async getRepository(_owner: string, _repo: string): Promise<GitHubRepository | null> {
    return null
  }
}

class FakeOpenCode implements OpenCodeService {
  sessions: OpenCodeSession[] = [openCodeSession]
  messages: OpenCodeMessage[] = [openCodeMessage]
  createError: Error | null = null
  promptError: Error | null = null
  promptCalls: Array<{ id: string; directory: string; text: string }> = []
  incomingEvents: OpenCodeEventEnvelope[] = []

  async listSessions(_directory: string): Promise<OpenCodeSession[]> {
    return this.sessions
  }

  async createSession(directory: string, title?: string): Promise<OpenCodeSession> {
    if (this.createError) {
      throw this.createError
    }
    return { ...openCodeSession, directory, title: title ?? openCodeSession.title }
  }

  async listMessages(_id: string, _directory: string): Promise<OpenCodeMessage[]> {
    return this.messages
  }

  async promptAsync(id: string, directory: string, text: string): Promise<void> {
    if (this.promptError) {
      throw this.promptError
    }
    this.promptCalls.push({ id, directory, text })
  }

  async *subscribeEvents(_directory: string, _signal?: AbortSignal): AsyncIterable<OpenCodeEventEnvelope> {
    for (const envelope of this.incomingEvents) {
      yield envelope
    }
  }
}

interface Fakes {
  workspaceRepo: FakeWorkspaceRepo
  sessionRepo: FakeSessionRepo
  git: FakeGit
  github: FakeGithub
  opencode: FakeOpenCode
}

function makeServicesNoop(services: Partial<RouteServices>) {
  return services
}

function setupFakes(): Fakes {
  return {
    workspaceRepo: new FakeWorkspaceRepo(),
    sessionRepo: new FakeSessionRepo(),
    git: new FakeGit(),
    github: new FakeGithub(),
    opencode: new FakeOpenCode(),
  }
}

async function readBody(response: Response): Promise<unknown> {
  return response.json()
}

describe("workspace routes", () => {
  it("lists empty workspaces", async () => {
    const fakes = setupFakes()
    const response = await listWorkspaces(makeRequest("http://localhost/api/workspaces"), {
      workspaceRepo: fakes.workspaceRepo,
    } as Partial<RouteServices>)
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { workspaces: WorkspaceRecord[] }
    assert.deepEqual(body.workspaces, [])
  })

  it("lists stored workspaces", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    const response = await listWorkspaces(makeRequest("http://localhost/api/workspaces"), {
      workspaceRepo: fakes.workspaceRepo,
    } as Partial<RouteServices>)
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { workspaces: WorkspaceRecord[] }
    assert.equal(body.workspaces.length, 1)
    assert.equal(body.workspaces[0]?.id, WORKSPACE_ID)
  })

  it("creates a workspace from a valid payload", async () => {
    const fakes = setupFakes()
    const response = await createWorkspace(
      makeJsonRequest("http://localhost/api/workspaces", { repository: "octocat/Hello-World", branch: "main" }),
      {
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        git: fakes.git,
        github: fakes.github,
        opencode: fakes.opencode,
      } as Partial<RouteServices>,
    )
    assert.equal(response.status, 200)
    assert.equal(fakes.git.cloned.length, 1)
    assert.equal(fakes.git.cloned[0]?.sshUrl, "git@github.com:octocat/Hello-World.git")
    const body = (await readBody(response)) as { workspace: WorkspaceRecord }
    assert.equal(body.workspace.repository, "octocat/Hello-World")
  })

  it("rejects a malformed body payload with a structured 400", async () => {
    const fakes = setupFakes()
    const response = await createWorkspace(
      makeJsonRequest("http://localhost/api/workspaces", { repository: "not-an-owner-slash-repo", branch: "main" }),
      makeServicesNoop({
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        git: fakes.git,
        github: fakes.github,
        opencode: fakes.opencode,
      }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string; issues?: Array<{ path: string[] }> } }
    assert.equal(body.error.code, "bad-request")
    assert.ok(Array.isArray(body.error.issues))
    assert.equal(fakes.git.cloned.length, 0)
  })

  it("rejects a payload missing the branch with a structured 400", async () => {
    const response = await createWorkspace(
      makeJsonRequest("http://localhost/api/workspaces", { repository: "octocat/Hello-World" }),
      makeServicesNoop({ git: new FakeGit(), github: new FakeGithub(), workspaceRepo: new FakeWorkspaceRepo(), sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("maps a git clone conflict to a structured 409", async () => {
    const fakes = setupFakes()
    fakes.git.error = new GitError("target-exists", "target exists")
    const response = await createWorkspace(
      makeJsonRequest("http://localhost/api/workspaces", { repository: "octocat/Hello-World", branch: "main" }),
      makeServicesNoop({
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        git: fakes.git,
        github: fakes.github,
        opencode: fakes.opencode,
      }),
    )
    assert.equal(response.status, 409)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "conflict")
  })

  it("maps a duplicate workspace to a structured 409", async () => {
    const fakes = setupFakes()
    const repo = "octocat/Hello-World"
    const branch = "main"
    const dir = "/workspaces/octocat/Hello-World"
    fakes.workspaceRepo.records.set(workspaceIdFor(repo, branch, dir), workspace({ id: workspaceIdFor(repo, branch, dir) }))
    const response = await createWorkspace(
      makeJsonRequest("http://localhost/api/workspaces", { repository: repo, branch }),
      makeServicesNoop({
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        git: fakes.git,
        github: fakes.github,
        opencode: fakes.opencode,
      }),
    )
    assert.equal(response.status, 409)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "conflict")
  })

  it("gets an existing workspace", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    const response = await getWorkspace(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab"),
      { id: WORKSPACE_ID },
      makeServicesNoop({ workspaceRepo: fakes.workspaceRepo }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { workspace: WorkspaceRecord }
    assert.equal(body.workspace.id, WORKSPACE_ID)
  })

  it("rejects a malformed workspace id with a structured 400", async () => {
    const response = await getWorkspace(
      makeRequest("http://localhost/api/workspaces/not-an-id"),
      { id: "not-an-id" },
      makeServicesNoop({ workspaceRepo: new FakeWorkspaceRepo() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("returns 404 for a missing workspace", async () => {
    const response = await getWorkspace(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab"),
      { id: WORKSPACE_ID },
      makeServicesNoop({ workspaceRepo: new FakeWorkspaceRepo() }),
    )
    assert.equal(response.status, 404)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "not-found")
  })
})

describe("session routes", () => {
  it("lists sessions for a workspace including the last session", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace({ lastSessionID: SESSION_ID }))
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await listSessions(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions"),
      { id: WORKSPACE_ID },
      makeServicesNoop({
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        opencode: fakes.opencode,
      }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { lastSessionID: string | null; sessions: SessionMappingRecord[] }
    assert.equal(body.lastSessionID, SESSION_ID)
    assert.equal(body.sessions.length, 1)
  })

  it("reconciles OpenCode sessions into Mongo and removes stale mappings", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace({ lastSessionID: "ses-stale" }))
    fakes.sessionRepo.records.set("ses-stale", mapping({ id: "ses-stale" }))
    fakes.opencode.sessions = [{ ...openCodeSession, id: SESSION_ID, title: "Official title" }]

    const response = await listSessions(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions"),
      { id: WORKSPACE_ID },
      makeServicesNoop({
        workspaceRepo: fakes.workspaceRepo,
        sessionRepo: fakes.sessionRepo,
        opencode: fakes.opencode,
      }),
    )

    assert.equal(response.status, 200)
    const body = (await readBody(response)) as {
      lastSessionID: string | null
      sessions: SessionMappingRecord[]
    }
    assert.equal(body.lastSessionID, SESSION_ID)
    assert.equal(body.sessions[0]?.title, "Official title")
    assert.equal(fakes.sessionRepo.records.has("ses-stale"), false)
  })

  it("creates a session and records the mapping", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    const response = await createSession(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions", { title: "My session" }),
      { id: WORKSPACE_ID },
      makeServicesNoop({ workspaceRepo: fakes.workspaceRepo, sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { session: OpenCodeSession; openCodeUrl: string }
    assert.equal(body.session.title, "My session")
    assert.match(body.openCodeUrl, /\/session\/ses-abc123$/)
    const record = fakes.sessionRepo.records.get(SESSION_ID)
    assert.ok(record)
    assert.equal(record.workspaceID, WORKSPACE_ID)
  })

  it("rejects a malformed workspace id on session create with 400", async () => {
    const response = await createSession(
      makeJsonRequest("http://localhost/api/workspaces/bad/sessions", {}),
      { id: "bad" },
      makeServicesNoop({ workspaceRepo: new FakeWorkspaceRepo(), sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("returns 404 when creating a session for a missing workspace", async () => {
    const response = await createSession(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions", {}),
      { id: WORKSPACE_ID },
      makeServicesNoop({ workspaceRepo: new FakeWorkspaceRepo(), sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 404)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "not-found")
  })
})

describe("session activation route", () => {
  it("activates an existing session belonging to the workspace", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await activateSession(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/activate", { method: "POST" }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ workspaceRepo: fakes.workspaceRepo, sessionRepo: fakes.sessionRepo }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { ok: boolean; lastSessionID: string }
    assert.equal(body.ok, true)
    assert.equal(body.lastSessionID, SESSION_ID)
    assert.equal(fakes.workspaceRepo.records.get(WORKSPACE_ID)?.lastSessionID, SESSION_ID)
  })

  it("rejects a malformed session id with 400", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    const response = await activateSession(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/bad/activate", { method: "POST" }),
      { id: WORKSPACE_ID, sessionId: "not a valid id!" },
      makeServicesNoop({ workspaceRepo: fakes.workspaceRepo, sessionRepo: fakes.sessionRepo }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("returns 404 when the session mapping is missing", async () => {
    const fakes = setupFakes()
    fakes.workspaceRepo.records.set(WORKSPACE_ID, workspace())
    const response = await activateSession(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/activate", { method: "POST" }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ workspaceRepo: fakes.workspaceRepo, sessionRepo: fakes.sessionRepo }),
    )
    assert.equal(response.status, 404)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "not-found")
  })
})

describe("messages route", () => {
  it("lists messages for an activated session", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await listMessages(
      makeRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/messages"),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { messages: OpenCodeMessage[] }
    assert.equal(body.messages.length, 1)
  })

  it("rejects malformed ids with 400", async () => {
    const response = await listMessages(
      makeRequest("http://localhost/api/workspaces/bad/sessions/bad/messages"),
      { id: "bad", sessionId: "bad!" },
      makeServicesNoop({ sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })
})

describe("prompt route", () => {
  it("forwards a valid prompt to the session and records it", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/prompt", { text: "Add a test" }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { ok: boolean; sessionID: string }
    assert.equal(body.ok, true)
    assert.equal(body.sessionID, SESSION_ID)
    assert.equal(fakes.opencode.promptCalls.length, 1)
    assert.equal(fakes.opencode.promptCalls[0]?.text, "Add a test")
    assert.equal(fakes.opencode.promptCalls[0]?.directory, mapping().directory)
  })

  it("rejects an empty prompt with a structured 400", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/prompt", { text: "   " }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string; issues?: Array<{ path: string[] }> } }
    assert.equal(body.error.code, "bad-request")
    assert.ok(Array.isArray(body.error.issues))
    assert.equal(fakes.opencode.promptCalls.length, 0)
  })

  it("rejects an over-long prompt with a structured 400", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/prompt", {
        text: "x".repeat(100_001),
      }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
    assert.equal(fakes.opencode.promptCalls.length, 0)
  })

  it("rejects malformed ids with 400", async () => {
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/bad/sessions/bad/prompt", { text: "hi" }),
      { id: "bad", sessionId: "bad!" },
      makeServicesNoop({ sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("returns 404 when the session mapping is missing", async () => {
    const fakes = setupFakes()
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/prompt", { text: "hi" }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 404)
    assert.equal(fakes.opencode.promptCalls.length, 0)
  })

  it("maps a prompt failure to an upstream error", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    fakes.opencode.promptError = new Error("prompt exploded")
    const response = await submitPrompt(
      makeJsonRequest("http://localhost/api/workspaces/ws-0123456789ab/sessions/ses-abc123/prompt", { text: "hi" }),
      { id: WORKSPACE_ID, sessionId: SESSION_ID },
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 502)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "upstream")
  })
})

describe("events route", () => {
  it("streams sse frames for the requested session only", async () => {
    const fakes = setupFakes()
    fakes.sessionRepo.records.set(SESSION_ID, mapping())
    fakes.opencode.incomingEvents = [
      {
        directory: mapping().directory,
        type: "session.status",
        sessionID: SESSION_ID,
        payload: { status: "busy" },
      },
      {
        directory: mapping().directory,
        type: "message.updated",
        sessionID: "ses-other",
        payload: {},
      },
      {
        directory: mapping().directory,
        type: "message.part.updated",
        sessionID: SESSION_ID,
        payload: {},
      },
    ]
    const response = await streamSessionEvents(
      makeRequest(`http://localhost/api/events?sessionId=${encodeURIComponent(SESSION_ID)}`),
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8")
    const body = await response.text()
    assert.match(body, /session\.status/)
    assert.match(body, /message\.part\.updated/)
    assert.doesNotMatch(body, /ses-other/)
  })

  it("rejects a missing session id with 400", async () => {
    const response = await streamSessionEvents(
      makeRequest("http://localhost/api/events"),
      makeServicesNoop({ sessionRepo: new FakeSessionRepo(), opencode: new FakeOpenCode() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })

  it("returns 404 when the session mapping is missing", async () => {
    const fakes = setupFakes()
    const response = await streamSessionEvents(
      makeRequest(`http://localhost/api/events?sessionId=${encodeURIComponent(SESSION_ID)}`),
      makeServicesNoop({ sessionRepo: fakes.sessionRepo, opencode: fakes.opencode }),
    )
    assert.equal(response.status, 404)
  })
})

describe("github routes", () => {
  it("searches repositories with a valid query", async () => {
    const fakes = setupFakes()
    fakes.github.repositories = [
      {
        id: 1,
        fullName: "octocat/Hello-World",
        url: "https://github.com/octocat/Hello-World",
        description: null,
        defaultBranch: "master",
        sshUrl: "git@github.com:octocat/Hello-World.git",
        cloneUrl: "https://github.com/octocat/Hello-World.git",
        owner: "octocat",
        name: "Hello-World",
      },
    ]
    const response = await searchRepositories(
      makeRequest("http://localhost/api/github/search?q=hello"),
      makeServicesNoop({ github: fakes.github }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { repositories: GitHubRepository[]; totalCount: number }
    assert.equal(body.totalCount, 1)
    assert.equal(body.repositories[0]?.fullName, "octocat/Hello-World")
  })

  it("rejects a missing query with a structured 400", async () => {
    const response = await searchRepositories(
      makeRequest("http://localhost/api/github/search"),
      makeServicesNoop({ github: new FakeGithub() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string; issues?: Array<{ path: string[] }> } }
    assert.equal(body.error.code, "bad-request")
    assert.ok(Array.isArray(body.error.issues))
  })

  it("maps a github configuration error to 503", async () => {
    const fakes = setupFakes()
    fakes.github.error = new GitHubError("configuration", "missing token")
    const response = await searchRepositories(
      makeRequest("http://localhost/api/github/search?q=hello"),
      makeServicesNoop({ github: fakes.github }),
    )
    assert.equal(response.status, 503)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "configuration")
  })

  it("lists branches for a valid owner and repo", async () => {
    const fakes = setupFakes()
    fakes.github.branches = [{ name: "main" }, { name: "dev" }]
    const response = await listBranches(
      makeRequest("http://localhost/api/github/octocat/Hello-World/branches"),
      { owner: "octocat", repo: "Hello-World" },
      makeServicesNoop({ github: fakes.github }),
    )
    assert.equal(response.status, 200)
    const body = (await readBody(response)) as { branches: GitHubBranch[] }
    assert.equal(body.branches.length, 2)
  })

  it("rejects a malformed owner with 400", async () => {
    const response = await listBranches(
      makeRequest("http://localhost/api/github/..%2F..%2Foutside/Hello-World/branches"),
      { owner: "../../outside", repo: "Hello-World" },
      makeServicesNoop({ github: new FakeGithub() }),
    )
    assert.equal(response.status, 400)
    const body = (await readBody(response)) as { error: { code: string } }
    assert.equal(body.error.code, "bad-request")
  })
})
