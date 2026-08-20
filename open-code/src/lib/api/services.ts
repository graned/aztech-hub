import "server-only"
import { getClient } from "../opencode/client"
import { createSession, listMessages, listSessions, promptAsync, subscribeEvents } from "../opencode/gateway"
import { getGithubConfig } from "../github/config"
import { GitHubClient, type GitHubSearchResult } from "../github/client"
import type { GitHubBranch, GitHubRepository } from "../github/types"
import { getSessionRepository } from "../mongodb/repositories"
import { getWorkspaceRepository } from "../mongodb/repositories"
import type { CreateWorkspaceInput } from "../mongodb/workspaceRepo"
import type { UpsertSessionMappingInput } from "../mongodb/sessionRepo"
import type { SessionMappingRecord, WorkspaceRecord } from "../mongodb/types"
import type { OpenCodeEventEnvelope, OpenCodeMessage, OpenCodeSession } from "../opencode/types"
import type { WorkspaceStatus } from "../git/types"
import { WorkspaceManager, type CloneWorkspaceOptions } from "../git/workspace-manager"

export interface WorkspaceRepoService {
  list(): Promise<WorkspaceRecord[]>
  get(id: string): Promise<WorkspaceRecord | null>
  create(input: CreateWorkspaceInput): Promise<WorkspaceRecord>
  updateLastSession(id: string, lastSessionID: string | null): Promise<WorkspaceRecord | null>
}

export interface SessionRepoService {
  listByWorkspace(workspaceID: string): Promise<SessionMappingRecord[]>
  get(id: string): Promise<SessionMappingRecord | null>
  upsert(input: UpsertSessionMappingInput): Promise<SessionMappingRecord>
  delete(id: string): Promise<boolean>
}

export interface GithubService {
  searchRepositories(query: string, limit?: number): Promise<GitHubSearchResult>
  listBranches(owner: string, repo: string): Promise<GitHubBranch[]>
  getRepository(owner: string, repo: string): Promise<GitHubRepository | null>
}

export interface GitService {
  clone(options: CloneWorkspaceOptions): Promise<string>
  status(directory: string): Promise<WorkspaceStatus>
}

export interface OpenCodeService {
  listSessions(directory: string): Promise<OpenCodeSession[]>
  createSession(directory: string, title?: string): Promise<OpenCodeSession>
  listMessages(id: string, directory: string, limit?: number): Promise<OpenCodeMessage[]>
  promptAsync(id: string, directory: string, text: string): Promise<void>
  subscribeEvents(directory: string, signal?: AbortSignal): AsyncIterable<OpenCodeEventEnvelope>
}

export interface ApiServices {
  workspaceRepo: WorkspaceRepoService
  sessionRepo: SessionRepoService
  github: GithubService
  git: GitService
  opencode: OpenCodeService
}

let cachedServices: ApiServices | null = null

export function getApiServices(): ApiServices {
  cachedServices ??= createApiServices()
  return cachedServices
}

export function createApiServices(): ApiServices {
  const opencodeClient = getClient()
  const manager = new WorkspaceManager()
  const githubClient = new GitHubClient({ config: getGithubConfig() })
  return {
    workspaceRepo: {
      async list() {
        return (await getWorkspaceRepository()).list()
      },
      async get(id) {
        return (await getWorkspaceRepository()).get(id)
      },
      async create(input) {
        return (await getWorkspaceRepository()).create(input)
      },
      async updateLastSession(id, lastSessionID) {
        return (await getWorkspaceRepository()).updateLastSession(id, lastSessionID)
      },
    },
    sessionRepo: {
      async listByWorkspace(workspaceID) {
        return (await getSessionRepository()).listByWorkspace(workspaceID)
      },
      async get(id) {
        return (await getSessionRepository()).get(id)
      },
      async upsert(input) {
        return (await getSessionRepository()).upsert(input)
      },
      async delete(id) {
        return (await getSessionRepository()).delete(id)
      },
    },
    github: {
      searchRepositories(query, limit) {
        return githubClient.searchRepositories(query, limit)
      },
      listBranches(owner, repo) {
        return githubClient.listBranches(owner, repo)
      },
      getRepository(owner, repo) {
        return githubClient.getRepository(owner, repo)
      },
    },
    git: {
      async clone(options) {
        return manager.clone(options)
      },
      async status(directory) {
        return manager.status(directory)
      },
    },
    opencode: {
      listSessions(directory) {
        return listSessions(directory, opencodeClient)
      },
      createSession(directory, title) {
        return createSession(directory, title, opencodeClient)
      },
      listMessages(id, directory, limit) {
        return listMessages(id, directory, limit, opencodeClient)
      },
      promptAsync(id, directory, text) {
        return promptAsync(id, directory, text, opencodeClient)
      },
      subscribeEvents(directory, signal) {
        return subscribeEvents(directory, opencodeClient, signal)
      },
    },
  }
}
