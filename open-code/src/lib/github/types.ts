import "server-only"

export interface GitHubRepository {
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

export interface GitHubBranch {
  name: string
}

export type GitHubErrorKind =
  | "configuration"
  | "authentication"
  | "rate-limit"
  | "not-found"
  | "invalid-identifier"
  | "upstream"

export class GitHubError extends Error {
  readonly name = "GitHubError"
  readonly kind: GitHubErrorKind
  constructor(kind: GitHubErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}