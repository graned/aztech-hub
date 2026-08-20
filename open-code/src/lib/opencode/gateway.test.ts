import { createServer, type Server } from "node:http"
import { after, before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "./client"
import { OpenCodeError, type OpenCodeProject } from "./types"
import {
  abort,
  createSession,
  deleteSession,
  getCurrentProject,
  getPath,
  getSession,
  getSessionStatus,
  getVcs,
  health,
  listMessages,
  listProjects,
  listSessions,
  prompt,
  promptAsync,
  subscribeEvents,
  subscribeGlobalEvents,
} from "./gateway"

interface FixtureResponse {
  status?: number
  headers?: Record<string, string>
  data?: unknown
}

interface FixtureHandler {
  (method: string, url: URL, body: unknown): FixtureResponse | undefined
}

function startFixtureServer(handlers: FixtureHandler[]): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const method = req.method ?? "GET"
    const url = new URL(req.url ?? "/", "http://localhost")
    let rawBody = ""
    req.on("data", (chunk) => (rawBody += chunk))
    req.on("end", () => {
      let parsedBody: unknown = undefined
      if (rawBody.length > 0) {
        try {
          parsedBody = JSON.parse(rawBody)
        } catch {
          parsedBody = rawBody
        }
      }
      let result: FixtureResponse | undefined
      for (const candidate of handlers) {
        const probe = candidate(method, url, parsedBody)
        if (probe !== undefined) {
          result = probe
          break
        }
      }
      const final = result ?? { status: 404, data: { error: "not found" } }
      const status = final.status ?? 200
      const headers = final.headers ?? { "Content-Type": "application/json" }
      res.writeHead(status, headers)
      if ((headers["Content-Type"] ?? "").includes("text/event-stream")) {
        res.write(String(final.data))
        return
      }
      if (final.data === undefined) {
        res.end()
        return
      }
      res.end(JSON.stringify(final.data))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: async () => {
          server.closeAllConnections()
          await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
        },
      })
    })
  })
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "ses_test",
    projectID: "global",
    directory: "/workspaces",
    title: "Test Session",
    version: "1.18.18",
    time: { created: 1000, updated: 2000 },
    ...overrides,
  }
}

function userMessageFixture() {
  return {
    id: "msg_user_1",
    sessionID: "ses_test",
    role: "user",
    time: { created: 900 },
    agent: "default",
    model: { providerID: "opencode", modelID: "deepseek-v4" },
  }
}

function assistantMessageFixture() {
  return {
    id: "msg_assistant_1",
    sessionID: "ses_test",
    role: "assistant",
    time: { created: 1000, completed: 2000 },
    parentID: "msg_user_1",
    modelID: "deepseek-v4",
    providerID: "opencode",
    mode: "single",
    path: { cwd: "/workspaces", root: "/workspaces" },
    cost: 0.001,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "completed",
  }
}

describe("opencode gateway", () => {
  let fixture: { url: string; close: () => Promise<void> }
  let client: ReturnType<typeof createClient>

  before(async () => {
    fixture = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/config") {
          return { data: { $schema: "https://opencode.ai/config.json", version: "1.18.18" } }
        }
        return undefined
      },
      (_method, url) => {
        if (url.pathname === "/project") {
          return {
            data: [
              { id: "p1", worktree: "/workspaces/a", vcsDir: "/workspaces/a/.git", vcs: "git", time: { created: 1, initialized: 2 } },
              { id: "p2", worktree: "/workspaces/b", time: { created: 3 } },
            ],
          }
        }
        return undefined
      },
      (_method, url) => {
        if (url.pathname === "/project/current") {
          return { data: { id: "p1", worktree: "/workspaces/a", vcs: "git", time: { created: 1, initialized: 2 } } }
        }
        return undefined
      },
      (_method, url) => {
        if (url.pathname === "/path") {
          return { data: { state: "/workspaces", config: "/workspaces/.opencode", worktree: "/workspaces", directory: "/workspaces" } }
        }
        return undefined
      },
      (_method, url) => {
        if (url.pathname === "/vcs") {
          return { data: { branch: "main" } }
        }
        return undefined
      },
      (method, url) => {
        if (method === "GET" && url.pathname === "/session") {
          return { data: [sessionFixture()] }
        }
        return undefined
      },
      (method, url, body) => {
        const title = (body as { title?: string } | undefined)?.title
        if (method === "POST" && url.pathname === "/session" && title !== undefined) {
          return { data: sessionFixture({ id: "ses_created", title }) }
        }
        return undefined
      },
      (_method, url) => {
        if (url.pathname === "/session/status") {
          return { data: { ses_test: { type: "idle" } } }
        }
        return undefined
      },
      (method, url) => {
        if (method === "GET" && url.pathname === "/session/ses_test") {
          return { data: sessionFixture() }
        }
        return undefined
      },
      (method, url) => {
        if (method === "DELETE" && url.pathname === "/session/ses_test") {
          return { data: true }
        }
        return undefined
      },
      (method, url) => {
        if (method === "GET" && url.pathname === "/session/ses_test/message") {
          return {
            data: [
              {
                info: userMessageFixture(),
                parts: [{ id: "part_1", sessionID: "ses_test", messageID: "msg_user_1", type: "text", text: "hello" }],
              },
              {
                info: assistantMessageFixture(),
                parts: [
                  { id: "part_2", sessionID: "ses_test", messageID: "msg_assistant_1", type: "text", text: "hi there", synthetic: true },
                  {
                    id: "part_3",
                    sessionID: "ses_test",
                    messageID: "msg_assistant_1",
                    type: "tool",
                    callID: "call_1",
                    tool: "bash",
                    state: { status: "completed", input: {}, output: "ok", title: "Run bash", metadata: {}, time: { start: 1, end: 2 } },
                  },
                ],
              },
            ],
          }
        }
        return undefined
      },
      (method, url, body) => {
        const parts = (body as { parts?: Array<{ type: string; text?: string }> } | undefined)?.parts ?? []
        if (method === "POST" && url.pathname === "/session/ses_test/message" && parts.length > 0) {
          return {
            data: {
              info: assistantMessageFixture(),
              parts: parts.map((part, index) => ({
                id: `part_prompt_${index}`,
                sessionID: "ses_test",
                messageID: "msg_assistant_1",
                type: "text",
                text: `echo: ${part.text ?? ""}`,
              })),
            },
          }
        }
        return undefined
      },
      (method, url) => {
        if (method === "POST" && url.pathname === "/session/ses_test/prompt_async") {
          return { status: 204, data: undefined }
        }
        return undefined
      },
      (method, url) => {
        if (method === "POST" && url.pathname === "/session/ses_test/abort") {
          return { data: true }
        }
        return undefined
      },
    ])
    client = createClient({ url: fixture.url, username: "user", password: "pass" })
  })

  after(async () => {
    await fixture.close()
  })

  test("health returns ok with version", async () => {
    const result = await health({ url: fixture.url, username: "user", password: "pass" }, client)
    assert.equal(result.ok, true)
    assert.equal(result.version, "1.18.18")
    assert.equal(result.url, fixture.url)
  })

  test("health maps 401 to unauthorized error", async () => {
    const fixture2 = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/config") {
          return { status: 401, data: { error: "unauthorized" } }
        }
        return undefined
      },
    ])
    const client2 = createClient({ url: fixture2.url, username: "user", password: "pass" })
    await assert.rejects(health({ url: fixture2.url, username: "user", password: "pass" }, client2), (error) => {
      assert.ok(error instanceof OpenCodeError)
      assert.equal(error.kind, "unauthorized")
      assert.equal(error.status, 401)
      return true
    })
    await fixture2.close()
  })

  test("listProjects maps two projects", async () => {
    const projects = await listProjects(client)
    assert.equal(projects.length, 2)
    assert.equal(projects[0]?.id, "p1")
    assert.equal(projects[0]?.vcs, "git")
    assert.equal(projects[0]?.initializedAt, 2)
    assert.equal(projects[1]?.vcs, null)
  })

  test("getCurrentProject returns typed project", async () => {
    const project: OpenCodeProject = await getCurrentProject("/workspaces/a", client)
    assert.equal(project.id, "p1")
    assert.equal(project.worktree, "/workspaces/a")
  })

  test("getPath returns state/config/worktree/directory", async () => {
    const value = await getPath(client)
    assert.deepEqual(value, { state: "/workspaces", config: "/workspaces/.opencode", worktree: "/workspaces", directory: "/workspaces" })
  })

  test("getVcs returns branch", async () => {
    const value = await getVcs("/workspaces", client)
    assert.deepEqual(value, { branch: "main" })
  })

  test("listSessions returns mapped sessions", async () => {
    const list = await listSessions("/workspaces", client)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.id, "ses_test")
    assert.equal(list[0]?.title, "Test Session")
    assert.equal(list[0]?.createdAt, 1000)
    assert.equal(list[0]?.updatedAt, 2000)
  })

  test("createSession returns mapped session", async () => {
    const session = await createSession("/workspaces", "New", client)
    assert.equal(session.title, "New")
    assert.equal(session.id, "ses_created")
  })

  test("getSession returns mapped session", async () => {
    const session = await getSession("ses_test", "/workspaces", client)
    assert.equal(session.id, "ses_test")
  })

  test("deleteSession returns true", async () => {
    const result = await deleteSession("ses_test", "/workspaces", client)
    assert.equal(result, true)
  })

  test("getSessionStatus returns idle", async () => {
    const statuses = await getSessionStatus("/workspaces", client)
    assert.deepEqual(statuses, { ses_test: "idle" })
  })

  test("listMessages maps text and tool parts", async () => {
    const messages = await listMessages("ses_test", "/workspaces", undefined, client)
    assert.equal(messages.length, 2)
    assert.equal(messages[0]?.role, "user")
    assert.equal(messages[0]?.parts[0]?.type, "text")
    assert.equal((messages[0]?.parts[0] as { text: string }).text, "hello")
    const assistant = messages[1]
    assert.equal(assistant?.role, "assistant")
    assert.equal(assistant?.model, "deepseek-v4")
    assert.deepEqual(assistant?.parts.map((part) => part.type), ["text", "tool"])
    const tool = assistant?.parts[1] as { type: "tool"; tool: string; state: string; title?: string }
    assert.equal(tool.tool, "bash")
    assert.equal(tool.state, "completed")
    assert.equal(tool.title, "Run bash")
  })

  test("prompt returns echoed assistant message", async () => {
    const result = await prompt("ses_test", "/workspaces", "ping", client)
    assert.equal(result.info.role, "assistant")
    assert.equal(result.parts.length, 1)
    assert.equal(result.parts[0]?.type, "text")
  })

  test("promptAsync returns void", async () => {
    const result = await promptAsync("ses_test", "/workspaces", "ping", client)
    assert.equal(result, undefined)
  })

  test("abort returns true", async () => {
    const result = await abort("ses_test", "/workspaces", client)
    assert.equal(result, true)
  })

  test("subscribeEvents surfaces event types", async () => {
    const payload = { type: "session.created", properties: { info: sessionFixture({ id: "ses_new" }) } }
    const fixture2 = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/event") {
          return {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
            data: `data: ${JSON.stringify(payload)}\n\n`,
          }
        }
        return undefined
      },
    ])
    const client2 = createClient({ url: fixture2.url })
    const controller = new AbortController()
    for await (const envelope of subscribeEvents("/workspaces", client2, controller.signal)) {
      assert.equal(envelope.type, "session.created")
      assert.equal(envelope.sessionID, "ses_new")
      assert.equal(envelope.directory, "/workspaces")
      controller.abort()
      break
    }
    await fixture2.close()
  })

  test("subscribeGlobalEvents maps directory from payload", async () => {
    const payload = { type: "session.deleted", properties: { info: sessionFixture({ id: "ses_gone" }) } }
    const fixture2 = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/global/event") {
          return {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
            data: `data: ${JSON.stringify({ directory: "/workspaces", payload })}\n\n`,
          }
        }
        return undefined
      },
    ])
    const client2 = createClient({ url: fixture2.url })
    const controller = new AbortController()
    for await (const envelope of subscribeGlobalEvents(client2, controller.signal)) {
      assert.equal(envelope.type, "session.deleted")
      assert.equal(envelope.directory, "/workspaces")
      assert.equal(envelope.sessionID, "ses_gone")
      controller.abort()
      break
    }
    await fixture2.close()
  })

  test("404 surfaces not-found error", async () => {
    const fixture2 = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/session/unknown") {
          return { status: 404, data: { error: "missing" } }
        }
        return undefined
      },
    ])
    const client2 = createClient({ url: fixture2.url })
    await assert.rejects(getSession("unknown", "/workspaces", client2), (error) => {
      assert.ok(error instanceof OpenCodeError)
      assert.equal(error.kind, "not-found")
      return true
    })
    await fixture2.close()
  })

  test("empty response maps to invalid-response", async () => {
    const fixture2 = await startFixtureServer([
      (_method, url) => {
        if (url.pathname === "/vcs") {
          return { data: undefined as unknown }
        }
        return undefined
      },
    ])
    const client2 = createClient({ url: fixture2.url })
    await assert.rejects(getVcs("/workspaces", client2), (error) => {
      assert.ok(error instanceof OpenCodeError)
      assert.equal(error.kind, "invalid-response")
      return true
    })
    await fixture2.close()
  })
})