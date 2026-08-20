import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { GitHubClient, isGithubBranch, isGithubOwner, isGithubRepo } from "./client"
import { GitHubError } from "./types"

interface FetchCall {
  url: URL
  headers: Record<string, string>
}

function makeFetcher(
  respond: (call: FetchCall) => { status: number; body: unknown },
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url)
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value
      }
    }
    calls.push({ url, headers })
    const { status, body } = respond({ url, headers })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const config = { token: "ghp_test_token", baseUrl: "https://api.github.com" }

describe("GitHubClient", () => {
  it("searches repositories and maps the result", async () => {
    const { fetchImpl, calls } = makeFetcher(() => ({
      status: 200,
      body: {
        total_count: 2,
        items: [
          {
            id: 1,
            full_name: "octo/widgets",
            html_url: "https://github.com/octo/widgets",
            description: "a widget library",
            default_branch: "main",
            ssh_url: "git@github.com:octo/widgets.git",
            clone_url: "https://github.com/octo/widgets.git",
          },
          {
            id: 2,
            full_name: "acme/tools",
            html_url: "https://github.com/acme/tools",
            description: null,
            default_branch: "master",
            ssh_url: "git@github.com:acme/tools.git",
            clone_url: "https://github.com/acme/tools.git",
          },
        ],
      },
    }))
    const client = new GitHubClient({ config, fetchImpl })
    const result = await client.searchRepositories("widgets", 5)
    assert.equal(result.totalCount, 2)
    assert.equal(result.repositories.length, 2)
    const first = result.repositories[0]!
    const second = result.repositories[1]!
    assert.equal(first.fullName, "octo/widgets")
    assert.equal(first.owner, "octo")
    assert.equal(first.name, "widgets")
    assert.equal(first.sshUrl, "git@github.com:octo/widgets.git")
    assert.equal(second.description, null)
    assert.equal(calls.length, 1)
    const call = calls[0]!
    assert.match(call.url.search, /q=widgets/)
    assert.equal(call.headers["authorization"], "Bearer ghp_test_token")
    assert.equal(call.headers["x-github-api-version"], "2022-11-28")
  })

  it("lists branches", async () => {
    const { fetchImpl } = makeFetcher(() => ({
      status: 200,
      body: [{ name: "main" }, { name: "dev" }],
    }))
    const client = new GitHubClient({ config, fetchImpl })
    const branches = await client.listBranches("octo", "widgets")
    assert.deepEqual(branches, [{ name: "main" }, { name: "dev" }])
  })

  it("rejects invalid owner/repository identifiers without calling the API", async () => {
    const { fetchImpl, calls } = makeFetcher(() => ({ status: 200, body: [] }))
    const client = new GitHubClient({ config, fetchImpl })
    await assert.rejects(
      () => client.listBranches("..", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "invalid-identifier",
    )
    await assert.rejects(
      () => client.getRepository("octo", "../widgets"),
      (error) => error instanceof GitHubError && error.kind === "invalid-identifier",
    )
    assert.equal(calls.length, 0)
  })

  it("throws a typed configuration error when no token is configured", async () => {
    const { fetchImpl, calls } = makeFetcher(() => ({ status: 200, body: [] }))
    const client = new GitHubClient({ config: { token: undefined }, fetchImpl })
    await assert.rejects(
      () => client.listBranches("octo", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "configuration",
    )
    assert.equal(calls.length, 0)
  })

  it("maps 401/403 to authentication and 429 to rate-limit", async () => {
    const { fetchImpl } = makeFetcher(() => ({ status: 403, body: { message: "forbidden" } }))
    const client = new GitHubClient({ config, fetchImpl })
    await assert.rejects(
      () => client.listBranches("octo", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "authentication",
    )

    const rateFetcher = makeFetcher(() => ({ status: 429, body: { message: "rate limited" } }))
    const rateClient = new GitHubClient({ config, fetchImpl: rateFetcher.fetchImpl })
    await assert.rejects(
      () => rateClient.listBranches("octo", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "rate-limit",
    )
  })

  it("returns null from getRepository on 404 but throws on other errors", async () => {
    const { fetchImpl } = makeFetcher(() => ({ status: 404, body: { message: "Not Found" } }))
    const client = new GitHubClient({ config, fetchImpl })
    const result = await client.getRepository("octo", "missing")
    assert.equal(result, null)

    const failureFetcher = makeFetcher(() => ({ status: 500, body: { message: "boom" } }))
    const failureClient = new GitHubClient({ config, fetchImpl: failureFetcher.fetchImpl })
    await assert.rejects(
      () => failureClient.getRepository("octo", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "upstream",
    )
  })

  it("throws a typed upstream error on malformed JSON", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as typeof fetch
    const client = new GitHubClient({ config, fetchImpl })
    await assert.rejects(
      () => client.listBranches("octo", "widgets"),
      (error) => error instanceof GitHubError && error.kind === "upstream",
    )
  })
})

describe("identifier validators", () => {
  it("isGithubOwner accepts valid owner names", () => {
    assert.equal(isGithubOwner("octo"), true)
    assert.equal(isGithubOwner("a"), true)
    assert.equal(isGithubOwner("a-b"), true)
  })

  it("isGithubOwner rejects traversal and invalid names", () => {
    assert.equal(isGithubOwner(".."), false)
    assert.equal(isGithubOwner("../etc"), false)
    assert.equal(isGithubOwner(""), false)
    assert.equal(isGithubOwner(".hidden"), false)
  })

  it("isGithubRepo rejects traversal", () => {
    assert.equal(isGithubRepo("widgets"), true)
    assert.equal(isGithubRepo(".."), false)
    assert.equal(isGithubRepo("..."), false)
    assert.equal(isGithubRepo("../widgets"), false)
    assert.equal(isGithubRepo(".hidden"), false)
    assert.equal(isGithubRepo("widgets."), false)
  })

  it("isGithubBranch rejects branch traversal and control characters", () => {
    assert.equal(isGithubBranch("main"), true)
    assert.equal(isGithubBranch("feature/x"), true)
    assert.equal(isGithubBranch(".."), false)
    assert.equal(isGithubBranch("a..b"), false)
    assert.equal(isGithubBranch("a@{b"), false)
    assert.equal(isGithubBranch("a b"), false)
    assert.equal(isGithubBranch("a\nb"), false)
    assert.equal(isGithubBranch("-start"), false)
  })
})