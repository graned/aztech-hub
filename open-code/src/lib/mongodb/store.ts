import "server-only"
import type {
  Db,
  Document,
  Filter,
  IndexSpecification,
  OptionalUnlessRequiredId,
  Sort,
  UpdateFilter,
  WithId,
} from "mongodb"

export interface MongoStore<T> {
  insertOne(doc: T): Promise<void>
  findOne(filter: Partial<T>): Promise<T | null>
  find(sort: Record<string, 1 | -1>, filter?: Partial<T>): Promise<T[]>
  updateOne(filter: Partial<T>, update: { $set: Partial<T> }): Promise<number>
  deleteOne(filter: Partial<T>): Promise<number>
  createIndex(spec: Record<string, 1 | -1>, options?: { unique?: boolean }): Promise<string>
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  )
}

export function mongoStoreFromDb<T extends Document>(db: Db, name: string): MongoStore<T> {
  const collection = db.collection<T>(name)
  return {
    async insertOne(doc) {
      await collection.insertOne(doc as OptionalUnlessRequiredId<T>)
    },
    async findOne(filter) {
      const found = await collection.findOne(filter as Filter<T>)
      return found === null ? null : stripId(found)
    },
    async find(sort, filter) {
      const docs = await collection
        .find(filter as Filter<T>)
        .sort(sort as Sort)
        .toArray()
      return docs.map((doc) => stripId(doc))
    },
    async updateOne(filter, update) {
      const result = await collection.updateOne(filter as Filter<T>, update as UpdateFilter<T>)
      return result.modifiedCount
    },
    async deleteOne(filter) {
      const result = await collection.deleteOne(filter as Filter<T>)
      return result.deletedCount
    },
    async createIndex(spec, options?) {
      if (options === undefined) {
        return collection.createIndex(spec as IndexSpecification)
      }
      return collection.createIndex(spec as IndexSpecification, options)
    },
  }
}

function stripId<T>(doc: WithId<T>): T {
  const copy = { ...doc }
  delete (copy as { _id?: unknown })._id
  return copy as T
}