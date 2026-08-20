import "server-only"

export type GitErrorKind =
  | "invalid-args"
  | "invalid-identifier"
  | "outside-root"
  | "target-exists"
  | "clone-failed"
  | "not-git-repo"
  | "command-failed"

export class GitError extends Error {
  readonly name = "GitError"
  readonly kind: GitErrorKind
  constructor(kind: GitErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

export interface GitRunner {
  run(args: string[], cwd: string): Promise<GitRunResult>
}

export interface WorkspaceStatus {
  branch: string
  clean: boolean
  ahead: number
  behind: number
}