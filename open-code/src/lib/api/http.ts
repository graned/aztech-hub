import "server-only"
import { ZodError } from "zod"
import { GitError } from "../git/types"
import { GitHubError } from "../github/types"
import { WorkspaceConflictError } from "../mongodb/types"
import { OpenCodeError } from "../opencode/types"

export type ApiErrorCode =
  | "bad-request"
  | "not-found"
  | "conflict"
  | "configuration"
  | "upstream"

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    issues?: Array<{ path: string[]; message: string }>
  }
}

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export function apiError(code: ApiErrorCode, message: string, status: number): Response {
  const body: ApiErrorBody = { error: { code, message } }
  switch (code) {
    case "bad-request":
      return Response.json(body, { status: status || 400 })
    case "not-found":
      return Response.json(body, { status: status || 404 })
    case "conflict":
      return Response.json(body, { status: status || 409 })
    case "configuration":
      return Response.json(body, { status: status || 503 })
    case "upstream":
      return Response.json(body, { status: status || 502 })
  }
}

export function validationError(error: unknown): Response {
  const body: ApiErrorBody = {
    error: {
      code: "bad-request",
      message: "Invalid request",
      ...(error instanceof ZodError && error.issues.length > 0
        ? {
            issues: error.issues.map((issue) => ({
              path: issue.path.map(String),
              message: issue.message,
            })),
          }
        : {}),
    },
  }
  return Response.json(body, { status: 400 })
}

export function notFound(message: string): Response {
  return apiError("not-found", message, 404)
}

export function conflict(message: string): Response {
  return apiError("conflict", message, 409)
}

export function upstream(message: string, status = 502): Response {
  return apiError("upstream", message, status)
}

export function mapServiceError(error: unknown): Response | undefined {
  if (error instanceof WorkspaceConflictError) {
    return conflict(error.message)
  }
  if (error instanceof GitHubError) {
    switch (error.kind) {
      case "configuration":
        return apiError("configuration", error.message, 503)
      case "not-found":
        return notFound(error.message)
      case "authentication":
      case "rate-limit":
      case "upstream":
        return upstream(error.message)
      case "invalid-identifier":
        return apiError("bad-request", error.message, 400)
    }
  }
  if (error instanceof GitError) {
    switch (error.kind) {
      case "invalid-identifier":
      case "outside-root":
        return apiError("bad-request", error.message, 400)
      case "target-exists":
        return conflict(error.message)
      case "clone-failed":
      case "not-git-repo":
      case "command-failed":
      case "invalid-args":
        return upstream(error.message)
    }
  }
  if (error instanceof OpenCodeError) {
    switch (error.kind) {
      case "unauthorized":
        return apiError("configuration", error.message, 503)
      case "not-found":
        return notFound(error.message)
      case "bad-request":
        return apiError("bad-request", error.message, 400)
      case "unreachable":
      case "upstream":
      case "invalid-response":
        return upstream(error.message)
    }
  }
  return undefined
}