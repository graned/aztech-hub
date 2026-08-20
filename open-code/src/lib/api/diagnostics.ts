import "server-only"
import { existsSync } from "node:fs"
import { pingMongo } from "../mongodb/client"
import { getGithubConfig } from "../github/config"
import { health as opencodeHealth } from "../opencode/gateway"
import { getServerConfig, type OpenCodeServerConfig } from "../opencode/config"
import { getWorkspaceRoot } from "../git/workspace-manager"

export type ServiceReachability = "ok" | "unreachable" | "not-configured"

export interface MongoDBDiagnostic {
  state: ServiceReachability
}

export interface OpenCodeDiagnostic {
  state: ServiceReachability
  version?: string
}

export interface GitHubDiagnostic {
  state: ServiceReachability
}

export interface GitDiagnostic {
  state: ServiceReachability
  root?: string
}

export interface Diagnostics {
  generatedAt: number
  mongodb: MongoDBDiagnostic
  opencode: OpenCodeDiagnostic
  github: GitHubDiagnostic
  git: GitDiagnostic
}

export interface DiagnosticsDeps {
  mongoPing?: () => Promise<boolean>
  opencodeProbe?: (config: OpenCodeServerConfig) => Promise<{ version?: string }>
  githubToken?: () => string | undefined
  workspaceRoot?: () => string
}

async function defaultOpenCodeProbe(config: OpenCodeServerConfig): Promise<{ version?: string }> {
  const result = await opencodeHealth(config)
  return result.version !== undefined ? { version: result.version } : {}
}

export async function getDiagnostics(deps: DiagnosticsDeps = {}): Promise<Diagnostics> {
  const mongoPing = deps.mongoPing ?? pingMongo
  const opencodeProbe = deps.opencodeProbe ?? defaultOpenCodeProbe
  const githubToken = deps.githubToken ?? (() => getGithubConfig().token)
  const workspaceRoot = deps.workspaceRoot ?? getWorkspaceRoot

  const [mongo, opencode, github, root] = await Promise.allSettled([
    Promise.resolve().then(() => mongoPing()),
    Promise.resolve().then(() => opencodeProbe(getServerConfig())),
    Promise.resolve().then(() => githubToken()),
    Promise.resolve().then(() => workspaceRoot()),
  ])

  const mongodb: MongoDBDiagnostic =
    mongo.status === "fulfilled" && mongo.value === true
      ? { state: "ok" }
      : { state: "unreachable" }

  const opencodeDiagnostic: OpenCodeDiagnostic =
    opencode.status === "fulfilled"
      ? { state: "ok", ...(opencode.value.version !== undefined ? { version: opencode.value.version } : {}) }
      : { state: "unreachable" }

  const githubDiagnostic: GitHubDiagnostic =
    github.status === "fulfilled" && github.value !== undefined
      ? { state: "ok" }
      : { state: "not-configured" }

  const rootValue = root.status === "fulfilled" ? root.value : "/workspaces"
  const git: GitDiagnostic = {
    state: existsSync(rootValue) ? "ok" : "unreachable",
    root: rootValue,
  }

  return {
    generatedAt: Date.now(),
    mongodb,
    opencode: opencodeDiagnostic,
    github: githubDiagnostic,
    git,
  }
}