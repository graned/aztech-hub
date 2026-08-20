import "server-only"

export interface OpenCodeServerConfig {
  url: string
  username?: string
  password?: string
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): OpenCodeServerConfig {
  const username = env["OPENCODE_SERVER_USERNAME"]
  const password = env["OPENCODE_SERVER_PASSWORD"]
  return {
    url: env["OPENCODE_URL"] ?? "http://localhost:4096",
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
  }
}

export function getBasicAuthHeader(config: OpenCodeServerConfig): string | undefined {
  if (!config.username || !config.password) {
    return undefined
  }
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
}
