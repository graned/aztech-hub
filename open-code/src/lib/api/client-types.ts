export interface ClientWorkspace {
  id: string
  repository: string
  branch: string
  directory: string
  createdAt: number
  updatedAt: number
  lastSessionID: string | null
}

export interface ClientSessionMapping {
  id: string
  workspaceID: string
  directory: string
  title?: string
  createdAt: number
  updatedAt: number
}

export interface ClientGitHubRepository {
  id: number
  fullName: string
  url: string
  description: string | null
  defaultBranch: string
  sshUrl: string
  cloneUrl: string
  owner: string
  name: string
}

export interface ClientGitHubBranch {
  name: string
}

export type ClientPart =
  | { type: "text"; id: string; text?: string; synthetic?: boolean }
  | { type: "reasoning"; id: string; text?: string }
  | { type: "tool"; id: string; callID?: string; tool?: string; state?: string; title?: string }
  | { type: "step-start"; id: string }
  | { type: "step-finish"; id: string; reason?: string; cost?: number; tokens?: unknown }
  | { type: "file"; id: string; filename?: string }
  | { type: "patch"; id: string; hash?: string; files?: string[] }
  | { type: "agent"; id: string; name?: string }
  | { type: "retry"; id: string; attempt?: number; error?: string }
  | { type: "compaction"; id: string; auto?: boolean }
  | { type: "subtask"; id: string; agent?: string; description?: string }
  | { type: "snapshot"; id: string }
  | { type: "unknown"; id: string }

export interface ClientMessage {
  id: string
  sessionID: string
  role: "user" | "assistant"
  createdAt: number
  parts: ClientPart[]
  model: string | null
  agent: string | null
  error: string | null
}

export interface ClientEventEnvelope {
  directory: string
  type: string
  sessionID?: string
  messageID?: string
  partID?: string
  payload: unknown
}

export interface ClientStepState {
  busy: boolean
  status: string | null
}
