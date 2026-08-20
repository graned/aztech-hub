import "server-only"
import { isDuplicateKeyError, type MongoStore } from "./store"
import type { SessionMappingRecord } from "./types"

export interface UpsertSessionMappingInput {
  id: string
  workspaceID: string
  directory: string
  title?: string
  createdAt?: number
  updatedAt?: number
}

export class SessionRepository {
  constructor(private readonly store: MongoStore<SessionMappingRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.store.createIndex({ id: 1 }, { unique: true })
    await this.store.createIndex({ workspaceID: 1, updatedAt: -1 })
  }

  async upsert(input: UpsertSessionMappingInput): Promise<SessionMappingRecord> {
    const now = Date.now()
    const record: SessionMappingRecord = {
      id: input.id,
      workspaceID: input.workspaceID,
      directory: input.directory,
      ...(input.title !== undefined ? { title: input.title } : {}),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }
    try {
      await this.store.insertOne(record)
      return record
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }
      await this.store.updateOne(
        { id: input.id },
        {
          $set: {
            workspaceID: input.workspaceID,
            directory: input.directory,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : { updatedAt: now }),
          },
        },
      )
      return (await this.store.findOne({ id: input.id })) ?? record
    }
  }

  async get(id: string): Promise<SessionMappingRecord | null> {
    return this.store.findOne({ id })
  }

  async listByWorkspace(workspaceID: string): Promise<SessionMappingRecord[]> {
    return this.store.find({ updatedAt: -1 }, { workspaceID })
  }

  async latestByWorkspace(workspaceID: string): Promise<SessionMappingRecord | null> {
    const sessions = await this.listByWorkspace(workspaceID)
    return sessions[0] ?? null
  }

  async delete(id: string): Promise<boolean> {
    return (await this.store.deleteOne({ id })) > 0
  }
}
