import "server-only"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"
import { getBasicAuthHeader, getServerConfig, type OpenCodeServerConfig } from "./config"

let cachedClient: OpencodeClient | null = null

export function createClient(config: OpenCodeServerConfig): OpencodeClient {
  const auth = getBasicAuthHeader(config)
  return createOpencodeClient({
    baseUrl: config.url,
    ...(auth !== undefined ? { headers: { Authorization: auth } } : {}),
  })
}

export function getClient(config: OpenCodeServerConfig = getServerConfig()): OpencodeClient {
  cachedClient ??= createClient(config)
  return cachedClient
}