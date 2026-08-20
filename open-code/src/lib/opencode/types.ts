export type OpenCodeSessionStatus = "idle" | "retry" | "busy"

export interface OpenCodeSession {
  id: string
  projectID: string
  directory: string
  title: string
  version: string
  createdAt: number
  updatedAt: number
}

export interface OpenCodeProject {
  id: string
  worktree: string
  vcs: "git" | null
  createdAt: number
  initializedAt?: number
}

export interface OpenCodePath {
  state: string
  config: string
  worktree: string
  directory: string
}

export interface OpenCodeVcs {
  branch: string | null
}

export interface OpenCodeTokenStats {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type OpenCodePart =
  | { type: "text"; id: string; text: string; synthetic?: boolean }
  | { type: "reasoning"; id: string; text: string }
  | { type: "tool"; id: string; callID: string; tool: string; state: string; title?: string }
  | { type: "step-start"; id: string; reason?: string }
  | { type: "step-finish"; id: string; reason: string; cost: number; tokens: OpenCodeTokenStats }
  | { type: "file"; id: string; mime: string; url: string; filename?: string }
  | { type: "patch"; id: string; hash: string; files: string[] }
  | { type: "agent"; id: string; name: string }
  | { type: "retry"; id: string; attempt: number; error?: string }
  | { type: "compaction"; id: string; auto: boolean }
  | { type: "subtask"; id: string; agent: string; description: string }
  | { type: "snapshot"; id: string }
  | { type: "unknown"; id: string }

export type OpenCodeMessageRole = "user" | "assistant"

export interface OpenCodeMessage {
  id: string
  sessionID: string
  role: OpenCodeMessageRole
  createdAt: number
  parts: OpenCodePart[]
  model: string | null
  agent: string | null
  error: string | null
}

export interface OpenCodePromptResult {
  info: OpenCodeMessage
  parts: OpenCodePart[]
}

export type OpenCodeEventType =
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.status"
  | "session.idle"
  | "session.compacted"
  | "session.error"
  | "message.updated"
  | "message.removed"
  | "message.part.updated"
  | "message.part.removed"
  | "permission.updated"
  | "permission.replied"
  | "command.executed"
  | "todo.updated"
  | "file.edited"
  | "vcs.branch.updated"
  | "file.watcher.updated"
  | "server.connected"
  | "pty.created"
  | "pty.updated"
  | "pty.exited"
  | "pty.deleted"
  | (string & {})

export interface OpenCodeEventEnvelope {
  directory: string
  type: OpenCodeEventType
  sessionID?: string
  messageID?: string
  partID?: string
  payload: unknown
}

export type OpenCodeErrorKind =
  | "unreachable"
  | "unauthorized"
  | "not-found"
  | "bad-request"
  | "invalid-response"
  | "upstream"

export class OpenCodeError extends Error {
  readonly kind: OpenCodeErrorKind
  readonly status: number | null

  constructor(kind: OpenCodeErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = "OpenCodeError"
    this.kind = kind
    this.status = status
  }
}