import "server-only"
import { spawn } from "node:child_process"
import type { GitRunResult, GitRunner } from "./types"

export const gitBinary: string = "git"

export function createNodeGitRunner(timeoutMs = 30000): GitRunner {
  return {
    run(args, cwd) {
      return new Promise<GitRunResult>((resolve) => {
        const child = spawn(gitBinary, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        let stdout = ""
        let stderr = ""
        child.stdout.setEncoding("utf8")
        child.stderr.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
          stdout += chunk
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk
        })
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          resolve({ code: -1, stdout, stderr: "git timed out" })
        }, timeoutMs)
        child.on("error", (error) => {
          clearTimeout(timer)
          resolve({ code: -1, stdout, stderr: error.message })
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({ code: code ?? -1, stdout, stderr })
        })
      })
    },
  }
}