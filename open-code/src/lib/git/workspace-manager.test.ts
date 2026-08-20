import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { WorkspaceManager, getWorkspaceRoot } from "./workspace-manager"
import { GitError, type GitRunResult, type GitRunner } from "./types"

interface RunCall {
  args: string[]
  cwd: string
}

class RecordingRunner implements GitRunner {
  calls: RunCall[] = []
  constructor(
    private readonly responses: Array<{
      match?: (args: string[]) => boolean
      result: GitRunResult
    }> = [],
  ) {}

  async run(args: string[], cwd: string): Promise<GitRunResult> {
    this.calls.push({ args, cwd })
    const response = this.responses.find((entry) => entry.match === undefined || entry.match(args))
    return response?.result ?? { code: 0, stdout: "", stderr: "" }
  }
}

const ok: GitRunResult = { code: 0, stdout: "", stderr: "" }

function tempWorkspaceRoot(): string {
  const root = path.join(tmpdir(), `wsm-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  return root
}

function cleanup(root: string): void {
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("getWorkspaceRoot", () => {
  it("defaults to /workspaces when WORKSPACE_ROOT is unset", () => {
    assert.equal(getWorkspaceRoot({}), "/workspaces")
  })

  it("honors WORKSPACE_ROOT from the environment", () => {
    assert.equal(getWorkspaceRoot({ WORKSPACE_ROOT: "/data/workspaces" }), "/data/workspaces")
  })
})

describe("WorkspaceManager.resolvePath", () => {
  it("resolves a valid owner/repo inside the root", () => {
    const root = tempWorkspaceRoot()
    try {
      const manager = new WorkspaceManager({ root })
      assert.equal(manager.resolvePath("acme", "widgets"), path.join(root, "acme", "widgets"))
    } finally {
      cleanup(root)
    }
  })

  it("rejects traversal and invalid identifiers without spawning a process", () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner()
      const manager = new WorkspaceManager({ root, runner })
      assert.throws(
        () => manager.resolvePath("..", "widgets"),
        (error) => error instanceof GitError && error.kind === "invalid-identifier",
      )
      assert.throws(
        () => manager.resolvePath("acme", "../widgets"),
        (error) => error instanceof GitError && error.kind === "invalid-identifier",
      )
      assert.throws(
        () => manager.resolvePath("acme", ".."),
        (error) => error instanceof GitError && error.kind === "invalid-identifier",
      )
      assert.equal(runner.calls.length, 0)
    } finally {
      cleanup(root)
    }
  })
})

describe("WorkspaceManager.clone", () => {
  it("spawns git clone with exact argv and returns the workspace path", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner([{ result: ok }])
      const manager = new WorkspaceManager({ root, runner })
      const target = await manager.clone({
        owner: "acme",
        repo: "widgets",
        branch: "main",
        sshUrl: "git@github.com:acme/widgets.git",
      })
      assert.equal(target, path.join(root, "acme", "widgets"))
      assert.equal(runner.calls.length, 1)
      const call = runner.calls[0]!
      assert.deepEqual(call.args, [
        "clone",
        "--branch",
        "main",
        "--depth",
        "1",
        "git@github.com:acme/widgets.git",
        path.join(root, "acme", "widgets"),
      ])
      assert.equal(call.cwd, root)
    } finally {
      cleanup(root)
    }
  })

  it("rejects an invalid branch without spawning a process", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner()
      const manager = new WorkspaceManager({ root, runner })
      await assert.rejects(
        manager.clone({ owner: "acme", repo: "widgets", branch: "a..b", sshUrl: "git@github.com:acme/widgets.git" }),
        (error) => error instanceof GitError && error.kind === "invalid-identifier",
      )
      assert.equal(runner.calls.length, 0)
    } finally {
      cleanup(root)
    }
  })

  it("fails with clone-failed when git reports a non-zero exit code", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner([
        { result: { code: 128, stdout: "", stderr: "fatal: could not read from remote" } },
      ])
      const manager = new WorkspaceManager({ root, runner })
      await assert.rejects(
        manager.clone({ owner: "acme", repo: "widgets", branch: "main", sshUrl: "git@github.com:acme/widgets.git" }),
        (error) => error instanceof GitError && error.kind === "clone-failed",
      )
    } finally {
      cleanup(root)
    }
  })

  it("fails with target-exists when the workspace directory already exists", async () => {
    const root = tempWorkspaceRoot()
    try {
      const existing = path.join(root, "acme", "widgets")
      mkdirSync(existing, { recursive: true })
      writeFileSync(path.join(existing, ".gitkeep"), "")
      const runner = new RecordingRunner()
      const manager = new WorkspaceManager({ root, runner })
      await assert.rejects(
        manager.clone({ owner: "acme", repo: "widgets", branch: "main", sshUrl: "git@github.com:acme/widgets.git" }),
        (error) => error instanceof GitError && error.kind === "target-exists",
      )
      assert.equal(runner.calls.length, 0)
    } finally {
      cleanup(root)
    }
  })
})

describe("WorkspaceManager.status", () => {
  it("reports branch, cleanliness, and ahead/behind counts", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner([
        {
          match: (args) => args[0] === "rev-parse",
          result: { code: 0, stdout: "main\n", stderr: "" },
        },
        {
          match: (args) => args[0] === "status",
          result: { code: 0, stdout: "", stderr: "" },
        },
        {
          match: (args) => args[0] === "rev-list",
          result: { code: 0, stdout: "2\t1\n", stderr: "" },
        },
      ])
      const manager = new WorkspaceManager({ root, runner })
      const workspaceDir = path.join(root, "acme", "widgets")
      const status = await manager.status(workspaceDir)
      assert.deepEqual(status, { branch: "main", clean: true, ahead: 2, behind: 1 })
      assert.equal(runner.calls.length, 3)
      const statusCall = runner.calls[1]!
      assert.deepEqual(statusCall.args, ["status", "--short"])
      assert.equal(statusCall.cwd, workspaceDir)
    } finally {
      cleanup(root)
    }
  })

  it("reports a dirty workspace from status --short output", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner([
        {
          match: (args) => args[0] === "rev-parse",
          result: { code: 0, stdout: "main\n", stderr: "" },
        },
        {
          match: (args) => args[0] === "status",
          result: { code: 0, stdout: " M package.json\n", stderr: "" },
        },
      ])
      const manager = new WorkspaceManager({ root, runner })
      const workspaceDir = path.join(root, "acme", "widgets")
      const status = await manager.status(workspaceDir)
      assert.equal(status.clean, false)
    } finally {
      cleanup(root)
    }
  })

  it("throws not-git-repo when rev-parse fails", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner([
        {
          match: (args) => args[0] === "rev-parse",
          result: { code: 128, stdout: "", stderr: "fatal: not a git repository" },
        },
      ])
      const manager = new WorkspaceManager({ root, runner })
      const workspaceDir = path.join(root, "acme", "widgets")
      await assert.rejects(
        manager.status(workspaceDir),
        (error) => error instanceof GitError && error.kind === "not-git-repo",
      )
    } finally {
      cleanup(root)
    }
  })

  it("rejects a path that escapes the workspace root without spawning a process", async () => {
    const root = tempWorkspaceRoot()
    try {
      const runner = new RecordingRunner()
      const manager = new WorkspaceManager({ root, runner })
      await assert.rejects(
        manager.status("../../outside"),
        (error) => error instanceof GitError && error.kind === "outside-root",
      )
      await assert.rejects(
        manager.status(path.join(root, "..", "outside")),
        (error) => error instanceof GitError && error.kind === "outside-root",
      )
      assert.equal(runner.calls.length, 0)
    } finally {
      cleanup(root)
    }
  })
})