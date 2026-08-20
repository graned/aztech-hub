import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getDiagnostics } from "../api/diagnostics"
import type { OpenCodeServerConfig } from "../opencode/config"

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "diag-"))
  writeFileSync(path.join(dir, ".keep"), "")
  return dir
}

describe("getDiagnostics", () => {
  it("reports ok states when every service is reachable", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => "ghp_token",
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.mongodb.state, "ok")
    assert.equal(diagnostics.opencode.state, "ok")
    assert.equal(diagnostics.opencode.version, "1.2.3")
    assert.equal(diagnostics.github.state, "ok")
    assert.equal(diagnostics.git.state, "ok")
    assert.equal(typeof diagnostics.generatedAt, "number")
  })

  it("reports unreachable when the mongo ping fails", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => false,
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => "ghp_token",
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.mongodb.state, "unreachable")
  })

  it("reports unreachable when the mongo ping throws", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => {
        throw new Error("connection refused")
      },
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => "ghp_token",
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.mongodb.state, "unreachable")
  })

  it("reports unreachable with no version when opencode is down", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async () => {
        throw new Error("connection refused")
      },
      githubToken: () => "ghp_token",
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.opencode.state, "unreachable")
    assert.equal(diagnostics.opencode.version, undefined)
  })

  it("reports not-configured when the github token is absent", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => undefined,
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.github.state, "not-configured")
  })

  it("reports unreachable when the workspace root is missing", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => "ghp_token",
      workspaceRoot: () => path.join(tmpdir(), "missing-diag-root"),
    })
    assert.equal(diagnostics.git.state, "unreachable")
  })

  it("handles a throwing workspace root probe", async () => {
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async () => ({ version: "1.2.3" }),
      githubToken: () => "ghp_token",
      workspaceRoot: () => {
        throw new Error("boom")
      },
    })
    assert.equal(diagnostics.git.state, "unreachable")
  })

  it("supports an empty opencode version", async () => {
    const seen = { url: "" }
    const diagnostics = await getDiagnostics({
      mongoPing: async () => true,
      opencodeProbe: async (given: OpenCodeServerConfig) => {
        seen.url = given.url
        return {}
      },
      githubToken: () => "ghp_token",
      workspaceRoot: () => tempRoot(),
    })
    assert.equal(diagnostics.opencode.state, "ok")
    assert.equal(diagnostics.opencode.version, undefined)
    assert.notEqual(seen.url, "")
  })
})