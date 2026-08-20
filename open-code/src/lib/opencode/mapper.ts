import type {
  AssistantMessage,
  GlobalEvent,
  Message,
  Part,
  Project,
  Session,
  SessionStatus,
  TextPartInput,
  UserMessage,
} from "@opencode-ai/sdk"
import type {
  OpenCodeEventEnvelope,
  OpenCodeMessage,
  OpenCodePart,
  OpenCodePromptResult,
  OpenCodeProject,
  OpenCodeSession,
  OpenCodeSessionStatus,
  OpenCodeTokenStats,
} from "./types"

export function mapSession(session: Session): OpenCodeSession {
  return {
    id: session.id,
    projectID: session.projectID,
    directory: session.directory,
    title: session.title,
    version: session.version,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  }
}

export function mapProject(project: Project): OpenCodeProject {
  return {
    id: project.id,
    worktree: project.worktree,
    vcs: project.vcs === "git" ? "git" : null,
    createdAt: project.time.created,
    ...(project.time.initialized !== undefined ? { initializedAt: project.time.initialized } : {}),
  }
}

function mapTokens(tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}): OpenCodeTokenStats {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  }
}

export function mapPart(part: Part): OpenCodePart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        id: part.id,
        text: part.text,
        ...(part.synthetic === true ? { synthetic: true } : {}),
      }
    case "reasoning":
      return { type: "reasoning", id: part.id, text: part.text }
    case "tool": {
      const toolState = part.state
      return {
        type: "tool",
        id: part.id,
        callID: part.callID,
        tool: part.tool,
        state: toolState.status,
        ...("title" in toolState && typeof toolState.title === "string" ? { title: toolState.title } : {}),
      }
    }
    case "step-start":
      return {
        type: "step-start",
        id: part.id,
      }
    case "step-finish":
      return {
        type: "step-finish",
        id: part.id,
        reason: part.reason,
        cost: part.cost,
        tokens: mapTokens(part.tokens),
      }
    case "file":
      return {
        type: "file",
        id: part.id,
        mime: part.mime,
        url: part.url,
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
      }
    case "patch":
      return { type: "patch", id: part.id, hash: part.hash, files: part.files }
    case "agent":
      return { type: "agent", id: part.id, name: part.name }
    case "retry":
      return {
        type: "retry",
        id: part.id,
        attempt: part.attempt,
        error: part.error.data.message,
      }
    case "compaction":
      return { type: "compaction", id: part.id, auto: part.auto }
    case "subtask":
      return { type: "subtask", id: part.id, agent: part.agent, description: part.description }
    case "snapshot":
      return { type: "snapshot", id: part.id }
    default: {
      const unknown = part as unknown as { type: string; id: string }
      return { type: "unknown", id: unknown.id }
    }
  }
}

export function mapParts(parts: Part[]): OpenCodePart[] {
  return parts.map(mapPart)
}

function messageModel(message: UserMessage | AssistantMessage): string | null {
  if (message.role === "user") {
    return message.model?.modelID ?? null
  }
  return message.modelID
}

function messageError(message: UserMessage | AssistantMessage): string | null {
  if ("error" in message && message.error !== undefined) {
    const data = (message.error as { data?: { message?: unknown } }).data
    const text = data?.message
    if (typeof text === "string") {
      return text
    }
    return JSON.stringify(message.error)
  }
  return null
}

export function mapMessage(info: Message, parts: Part[]): OpenCodeMessage {
  return {
    id: info.id,
    sessionID: info.sessionID,
    role: info.role,
    createdAt: info.time.created,
    parts: mapParts(parts),
    model: messageModel(info),
    agent: "agent" in info && info.agent !== undefined ? info.agent : null,
    error: messageError(info),
  }
}

export function mapMessages(messages: Array<{ info: Message; parts: Part[] }>): OpenCodeMessage[] {
  return messages.map((entry) => mapMessage(entry.info, entry.parts))
}

export function mapPromptResult(result: {
  info: AssistantMessage
  parts: Part[]
}): OpenCodePromptResult {
  return {
    info: mapMessage(result.info, result.parts),
    parts: mapParts(result.parts),
  }
}

export function mapSessionStatus(status: Record<string, SessionStatus>): Record<string, OpenCodeSessionStatus> {
  const out: Record<string, OpenCodeSessionStatus> = {}
  for (const [sessionID, sessionStatus] of Object.entries(status)) {
    out[sessionID] = sessionStatus.type
  }
  return out
}

export function toTextPartInput(text: string): TextPartInput {
  return { type: "text", text }
}

export function mapGlobalEvent(event: GlobalEvent): OpenCodeEventEnvelope {
  const payload = event.payload
  const properties =
    typeof payload === "object" && payload !== null && "properties" in payload
      ? (payload as { type: string; properties?: Record<string, unknown> }).properties
      : undefined
  const envelope: OpenCodeEventEnvelope = {
    directory: event.directory,
    type: payload.type,
    payload,
  }
  if (properties !== undefined) {
    if (typeof properties["sessionID"] === "string") {
      envelope.sessionID = properties["sessionID"]
    }
    if (typeof properties["messageID"] === "string") {
      envelope.messageID = properties["messageID"]
    }
    if (typeof properties["partID"] === "string") {
      envelope.partID = properties["partID"]
    }
    if (
      payload.type === "session.created" ||
      payload.type === "session.updated" ||
      payload.type === "session.deleted"
    ) {
      const info = properties["info"] as { id?: unknown } | undefined
      if (typeof info?.id === "string") {
        envelope.sessionID = info.id
      }
    }
  }
  return envelope
}