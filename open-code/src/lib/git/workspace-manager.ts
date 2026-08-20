import "server-only"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { isGithubBranch, isGithubOwner, isGithubRepo } from "../github/client"
import { createNodeGitRunner } from "./runner"
import { GitError, type GitRunner, type WorkspaceStatus } from "./types"

export interface WorkspaceManagerDeps {
  root?: string
  runner?: GitRunner
}

export function getWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
): string {
  return env["WORKSPACE_ROOT"] ?? "/workspaces"
}

export interface CloneWorkspaceOptions {
  owner: string
  repo: string
  branch: string
  sshUrl: string
  directory?: string
}

export class WorkspaceManager {
  readonly root: string
  private readonly runner: GitRunner

  constructor(deps: WorkspaceManagerDeps = {}) {
    this.root = deps.root ?? getWorkspaceRoot()
    this.runner = deps.runner ?? createNodeGitRunner()
  }

  resolvePath(owner: string, repo: string): string {
    if (!isGithubOwner(owner) || !isGithubRepo(repo)) {
      throw new GitError("invalid-identifier", `Invalid repository identifier ${owner}/${repo}`)
    }
    const candidate = path.resolve(this.root, owner, repo)
    this.assertContained(candidate)
    return candidate
  }

  async clone(options: CloneWorkspaceOptions): Promise<string> {
    if (!isGithubBranch(options.branch)) {
      throw new GitError("invalid-identifier", `Invalid branch name ${options.branch}`)
    }
    const target = path.resolve(options.directory ?? this.resolvePath(options.owner, options.repo))
    this.assertContained(target)
    if (existsSync(target) && readdirSync(target).length > 0) {
      throw new GitError("target-exists", `Workspace directory already exists: ${target}`)
    }
    const args = [
      "clone",
      "--branch",
      options.branch,
      "--depth",
      "1",
      options.sshUrl,
      target,
    ]
    const result = await this.runner.run(args, this.root)
    if (result.code !== 0) {
      throw new GitError(
        "clone-failed",
        result.stderr.trim() || `git clone failed with exit code ${result.code}`,
      )
    }
    return target
  }

  async status(directory: string): Promise<WorkspaceStatus> {
    this.assertContained(path.resolve(directory))
    const branchResult = await this.runner.run(["rev-parse", "--abbrev-ref", "HEAD"], directory)
    if (branchResult.code !== 0) {
      throw new GitError("not-git-repo", branchResult.stderr.trim() || "not a git repository")
    }
    const statusResult = await this.runner.run(["status", "--short"], directory)
    if (statusResult.code !== 0) {
      throw new GitError("command-failed", statusResult.stderr.trim() || "git status failed")
    }
    const aheadBehind =
      (await this.runner.run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], directory))
    let ahead = 0
    let behind = 0
    const counts = aheadBehind.stdout.trim().split(/\s+/)
    if (aheadBehind.code === 0 && counts.length >= 2) {
      ahead = Number(counts[0] ?? 0)
      behind = Number(counts[1] ?? 0)
    }
    return {
      branch: branchResult.stdout.trim(),
      clean: statusResult.stdout.trim().length === 0,
      ahead,
      behind,
    }
  }

  private assertContained(candidate: string): void {
    const relative = path.relative(this.root, candidate)
    const outside =
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    if (outside) {
      throw new GitError("outside-root", `Path escapes workspace root: ${candidate}`)
    }
  }
}