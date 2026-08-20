import "server-only"
import { getDb } from "./client"
import { SessionRepository } from "./sessionRepo"
import { WorkspaceRepository } from "./workspaceRepo"
import { mongoStoreFromDb } from "./store"
import type { SessionMappingRecord, WorkspaceRecord } from "./types"

export const WORKSPACES_COLLECTION = "workspaces"
export const SESSION_MAPPINGS_COLLECTION = "session_mappings"

export async function getWorkspaceRepository(): Promise<WorkspaceRepository> {
  const db = await getDb()
  return new WorkspaceRepository(mongoStoreFromDb<WorkspaceRecord>(db, WORKSPACES_COLLECTION))
}

export async function getSessionRepository(): Promise<SessionRepository> {
  const db = await getDb()
  return new SessionRepository(mongoStoreFromDb<SessionMappingRecord>(db, SESSION_MAPPINGS_COLLECTION))
}