import "server-only"
import { GitHubError, type GitHubBranch, type GitHubErrorKind, type GitHubRepository } from "./types"

export interface GitHubClientDeps {
  config: { token: string | undefined; baseUrl?: string }
  fetchImpl?: typeof fetch
}

export interface GitHubSearchResult {
  repositories: GitHubRepository[]
  totalCount: number
}

export function isGithubOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)
}

export function isGithubRepo(name: string): boolean {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.test(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    name !== ".."
  )
}

export function isGithubBranch(value: string): boolean {
  if (value.length === 0 || value.length > 255) {
    return false
  }
  if (value.includes("..") || value.includes("@{") || value.includes(" ") || value.includes("\n")) {
    return false
  }
  if (value.startsWith("-") || value.endsWith(".") || value.includes("//")) {
    return false
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
}

export class GitHubClient {
  private readonly token: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(deps: GitHubClientDeps) {
    this.token = deps.config.token
    this.baseUrl = deps.config.baseUrl ?? "https://api.github.com"
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  async searchRepositories(query: string, limit = 10): Promise<GitHubSearchResult> {
    const url = new URL("/search/repositories", this.baseUrl)
    url.searchParams.set("q", query)
    url.searchParams.set("per_page", String(limit))
    const record = asRecord(await this.request(url, "searchRepositories"))
    return {
      totalCount: asFiniteNumber(record["total_count"], 0),
      repositories: asArray(record["items"]).map((item) => mapRepository(item)),
    }
  }

  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    if (!isGithubOwner(owner) || !isGithubRepo(repo)) {
      throw new GitHubError("invalid-identifier", "Invalid GitHub owner/repository identifier")
    }
    const url = new URL(`/repos/${owner}/${repo}/branches`, this.baseUrl)
    url.searchParams.set("per_page", "100")
    const body = await this.request(url, "listBranches")
    return asArray(body).map((branch) => ({ name: asString(branch["name"], "") }))
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepository | null> {
    if (!isGithubOwner(owner) || !isGithubRepo(repo)) {
      throw new GitHubError("invalid-identifier", "Invalid GitHub owner/repository identifier")
    }
    try {
      const body = await this.request(`/repos/${owner}/${repo}`, "getRepository")
      return mapRepository(body as Record<string, unknown>)
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") {
        return null
      }
      throw error
    }
  }

  private async request(
    pathOrUrl: string | URL,
    operation: string,
  ): Promise<Record<string, unknown> | unknown[]> {
    const url = typeof pathOrUrl === "string" ? new URL(pathOrUrl, this.baseUrl) : pathOrUrl
    if (this.token === undefined) {
      throw new GitHubError("configuration", "GITHUB_TOKEN is not configured")
    }
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!response.ok) {
      throw new GitHubError(mapStatus(response.status), `GitHub returned HTTP ${response.status}`)
    }
    try {
      return (await response.json()) as Record<string, unknown> | unknown[]
    } catch {
      throw new GitHubError("upstream", `GitHub returned malformed JSON for ${operation}`)
    }
  }
}

function mapRepository(item: Record<string, unknown>): GitHubRepository {
  const fullName = asString(item["full_name"], "")
  const [owner = "", name = ""] = fullName.split("/")
  return {
    id: asFiniteNumber(item["id"], 0),
    fullName,
    url: asString(item["html_url"], ""),
    description: asNullableString(item["description"]),
    defaultBranch: asString(item["default_branch"], "main"),
    sshUrl: asString(item["ssh_url"], `git@github.com:${fullName}.git`),
    cloneUrl: asString(item["clone_url"], ""),
    owner,
    name,
  }
}

function mapStatus(status: number): GitHubErrorKind {
  switch (status) {
    case 401:
    case 403:
      return "authentication"
    case 404:
      return "not-found"
    case 429:
      return "rate-limit"
    default:
      return "upstream"
  }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}