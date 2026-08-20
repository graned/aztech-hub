import "server-only"

export interface GitHubClientConfig {
  token: string | undefined
  baseUrl?: string
}

export function getGithubConfig(env: NodeJS.ProcessEnv = process.env): GitHubClientConfig {
  const token = env["GITHUB_TOKEN"]
  const baseUrl = env["GITHUB_API_URL"]
  return {
    token: token === undefined || token === "" ? undefined : token,
    ...(baseUrl !== undefined && baseUrl !== "" ? { baseUrl } : {}),
  }
}