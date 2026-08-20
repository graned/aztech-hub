import "server-only"
import { MongoClient, type Db } from "mongodb"

let cachedClient: MongoClient | null = null
let cachedDb: Promise<Db> | null = null

export function getMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  return env["MONGODB_URI"] ?? "mongodb://localhost:27017/opencode_workspace_manager"
}

export function getMongoClient(uri: string = getMongoUri()): MongoClient {
  cachedClient ??= new MongoClient(uri)
  return cachedClient
}

export async function getDb(): Promise<Db> {
  cachedDb ??= (async () => {
    const client = getMongoClient()
    await client.connect()
    return client.db()
  })()
  return cachedDb
}

export interface Commandable {
  command(command: Record<string, number>): Promise<{ [key: string]: unknown }>
}

export async function pingDb(db: Commandable): Promise<boolean> {
  try {
    const result = await db.command({ ping: 1 })
    return typeof result === "object" && result !== null && result["ok"] === 1
  } catch {
    return false
  }
}

export async function pingMongo(): Promise<boolean> {
  return pingDb(await getDb())
}

export async function disconnectMongo(): Promise<void> {
  if (cachedClient !== null) {
    await cachedClient.close()
    cachedClient = null
    cachedDb = null
  }
}