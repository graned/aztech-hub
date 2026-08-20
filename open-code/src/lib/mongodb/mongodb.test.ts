import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pingDb } from "./client"
import { SessionRepository } from "./sessionRepo"
import { isDuplicateKeyError, type MongoStore } from "./store"
import { WorkspaceConflictError } from "./types"
import { WorkspaceRepository } from "./workspaceRepo"

type Doc = { id: string }

class MemoryStore<T extends Doc> implements MongoStore<T> {
  private readonly docs: T[] = []
  private readonly uniqueIndexes: Array<Record<string, 1 | -1>> = []

  async createIndex(spec: Record<string, 1 | -1>, options?: { unique?: boolean }): Promise<string> {
    if (options?.unique === true) {
      this.uniqueIndexes.push(spec)
    }
    return "index"
  }

  async insertOne(doc: T): Promise<void> {
    if (this.violatesUnique(doc)) {
      throw duplicateKeyError()
    }
    this.docs.push({ ...doc })
  }

  async findOne(filter: Partial<T>): Promise<T | null> {
    const found = this.docs.find((doc) => matches(doc, filter))
    return found === undefined ? null : { ...found }
  }

  async find(sort: Record<string, 1 | -1>, filter?: Partial<T>): Promise<T[]> {
    const filtered = this.docs.filter((doc) => filter === undefined || matches(doc, filter))
    return [...filtered]
      .sort((a, b) => compareBy(a, b, sort))
      .map((doc) => ({ ...doc }))
  }

  async updateOne(filter: Partial<T>, update: { $set: Partial<T> }): Promise<number> {
    let modifiedCount = 0
    for (const doc of this.docs) {
      if (matches(doc, filter)) {
        Object.assign(doc, update.$set)
        modifiedCount += 1
      }
    }
    return modifiedCount
  }

  async deleteOne(filter: Partial<T>): Promise<number> {
    const index = this.docs.findIndex((doc) => matches(doc, filter))
    if (index === -1) {
      return 0
    }
    this.docs.splice(index, 1)
    return 1
  }

  private violatesUnique(doc: T): boolean {
    return this.uniqueIndexes.some((index) =>
      this.docs.some((existing) =>
        Object.keys(index).every(
          (key) => (existing as Record<string, unknown>)[key] === (doc as Record<string, unknown>)[key],
        ),
      ),
    )
  }
}

function matches<T>(doc: T, filter: Partial<T>): boolean {
  return Object.entries(filter).every(
    ([key, value]) => (doc as Record<string, unknown>)[key] === value,
  )
}

function compareBy<T>(a: T, b: T, sort: Record<string, 1 | -1>): number {
  for (const [key, dir] of Object.entries(sort)) {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (av === bv) {
      continue
    }
    const cmp = Number(av) > Number(bv) ? 1 : -1
    return cmp * dir
  }
  return 0
}

function duplicateKeyError(): unknown {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
}

describe("workspace repository", () => {
  const input = { repository: "aztech-hub/open-code", branch: "main", directory: "/workspaces/open-code" }

  it("creates a workspace with generated id and null last session", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    const record = await repo.create(input)
    assert.match(record.id, /^ws-[0-9a-f]+$/)
    assert.equal(record.repository, input.repository)
    assert.equal(record.branch, input.branch)
    assert.equal(record.directory, input.directory)
    assert.equal(record.lastSessionID, null)
    assert.equal(typeof record.createdAt, "number")
    assert.equal(typeof record.updatedAt, "number")
  })

  it("rejects a duplicate repository-branch-directory insertion with a typed conflict", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    await repo.ensureIndexes()
    await repo.create(input)
    await assert.rejects(repo.create(input), (error) => {
      assert.ok(error instanceof WorkspaceConflictError)
      assert.equal(error.kind, "workspace-conflict")
      return true
    })
  })

  it("allows the same repository at a different directory", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    await repo.ensureIndexes()
    const first = await repo.create(input)
    const second = await repo.create({ ...input, directory: "/workspaces/open-code-alt" })
    assert.notEqual(first.id, second.id)
  })

  it("lists workspaces sorted by updatedAt descending", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    const older = await repo.create({ ...input, directory: "/workspaces/a" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newer = await repo.create({ ...input, directory: "/workspaces/b" })
    const list = await repo.list()
    assert.deepEqual(
      list.map((workspace) => workspace.id),
      [newer.id, older.id],
    )
  })

  it("gets a workspace by id and by directory", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    const record = await repo.create(input)
    assert.deepEqual(await repo.get(record.id), record)
    assert.deepEqual(await repo.getByDirectory(input.directory), record)
    assert.equal(await repo.get("ws-missing"), null)
    assert.equal(await repo.getByDirectory("/workspaces/missing"), null)
  })

  it("updates the last session and bumps updatedAt", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    await new Promise((resolve) => setTimeout(resolve, 5))
    const record = await repo.create(input)
    const updated = await repo.updateLastSession(record.id, "ses_test_1")
    assert.ok(updated !== null)
    assert.equal(updated?.lastSessionID, "ses_test_1")
    assert.ok(updated?.updatedAt >= record.updatedAt)
    const fetched = await repo.get(record.id)
    assert.equal(fetched?.lastSessionID, "ses_test_1")
  })

  it("returns null when updating a missing workspace", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    assert.equal(await repo.updateLastSession("ws-missing", "ses_test_1"), null)
  })

  it("deletes a workspace and reports whether it existed", async () => {
    const repo = new WorkspaceRepository(new MemoryStore())
    const record = await repo.create(input)
    assert.equal(await repo.delete(record.id), true)
    assert.equal(await repo.delete(record.id), false)
    assert.equal(await repo.get(record.id), null)
  })
})

describe("session mapping repository", () => {
  it("inserts a session mapping", async () => {
    const repo = new SessionRepository(new MemoryStore())
    const record = await repo.upsert({ id: "ses_test_1", workspaceID: "ws_1", directory: "/workspaces/open-code" })
    assert.equal(record.id, "ses_test_1")
    assert.equal(record.workspaceID, "ws_1")
    assert.equal(record.directory, "/workspaces/open-code")
  })

  it("updates an existing session mapping instead of duplicating", async () => {
    const repo = new SessionRepository(new MemoryStore())
    await repo.ensureIndexes()
    const first = await repo.upsert({ id: "ses_test_1", workspaceID: "ws_1", directory: "/workspaces/a" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await repo.upsert({ id: "ses_test_1", workspaceID: "ws_2", directory: "/workspaces/b" })
    assert.equal(second.id, "ses_test_1")
    assert.equal(second.workspaceID, "ws_2")
    assert.equal(second.directory, "/workspaces/b")
    assert.equal(first.createdAt, second.createdAt)
    const all = await repo.listByWorkspace("ws_2")
    assert.deepEqual(
      all.map((mapping) => mapping.id),
      ["ses_test_1"],
    )
    assert.deepEqual(
      (await repo.listByWorkspace("ws_1")).map((mapping) => mapping.id),
      [],
    )
  })

  it("finds the latest session per workspace", async () => {
    const repo = new SessionRepository(new MemoryStore())
    await repo.upsert({ id: "ses_a", workspaceID: "ws_1", directory: "/workspaces/a" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await repo.upsert({ id: "ses_b", workspaceID: "ws_1", directory: "/workspaces/a" })
    const latest = await repo.latestByWorkspace("ws_1")
    assert.equal(latest?.id, "ses_b")
    assert.equal(await repo.latestByWorkspace("ws_other"), null)
  })

  it("gets and deletes a session mapping", async () => {
    const repo = new SessionRepository(new MemoryStore())
    const record = await repo.upsert({ id: "ses_test_1", workspaceID: "ws_1", directory: "/workspaces/a" })
    assert.deepEqual(await repo.get("ses_test_1"), record)
    assert.equal(await repo.delete("ses_test_1"), true)
    assert.equal(await repo.delete("ses_test_1"), false)
  })
})

describe("mongo health ping", () => {
  it("returns true when the ping command reports ok", async () => {
    const fake = {
      async command(): Promise<{ [key: string]: unknown }> {
        return { ok: 1 }
      },
    }
    assert.equal(await pingDb(fake), true)
  })

  it("returns false when the ping command throws", async () => {
    const fake = {
      async command(): Promise<{ [key: string]: unknown }> {
        throw new Error("connection refused")
      },
    }
    assert.equal(await pingDb(fake), false)
  })

  it("classifies the fake duplicate-key error as a duplicate", () => {
    assert.equal(isDuplicateKeyError(duplicateKeyError()), true)
    assert.equal(isDuplicateKeyError(new Error("other")), false)
  })
})