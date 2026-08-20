import "server-only"
import { isDuplicateKeyError, type MongoStore } from "./store"
import { WorkspaceConflictError, workspaceIdFor, type WorkspaceRecord } from "./types"

export interface CreateWorkspaceInput {
  repository: string
  branch: string
  directory: string
}

export class WorkspaceRepository {
  constructor(private readonly store: MongoStore<WorkspaceRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.store.createIndex({ repository: 1, branch: 1, directory: 1 }, { unique: true })
    await this.store.createIndex({ updatedAt: -1 })
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const now = Date.now()
    const record: WorkspaceRecord = {
      id: workspaceIdFor(input.repository, input.branch, input.directory),
      repository: input.repository,
      branch: input.branch,
      directory: input.directory,
      createdAt: now,
      updatedAt: now,
      lastSessionID: null,
    }
    try {
      await this.store.insertOne(record)
      return record
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new WorkspaceConflictError(input.repository, input.branch, input.directory)
      }
      throw error
    }
  }

  async list(): Promise<WorkspaceRecord[]> {
    return this.store.find({ updatedAt: -1 })
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    return this.store.findOne({ id })
  }

  async getByDirectory(directory: string): Promise<WorkspaceRecord | null> {
    return this.store.findOne({ directory })
  }

  async updateLastSession(id: string, lastSessionID: string | null): Promise<WorkspaceRecord | null> {
    await this.store.updateOne(
      { id },
      { $set: { lastSessionID: lastSessionID, updatedAt: Date.now() } },
    )
    return this.store.findOne({ id })
  }

  async delete(id: string): Promise<boolean> {
    return (await this.store.deleteOne({ id })) > 0
  }
}