"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { ClientSessionMapping, ClientWorkspace } from "@/lib/api/client-types"

interface SessionResponse {
  workspace: ClientWorkspace
  sessions: ClientSessionMapping[]
  lastSessionID: string | null
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function WorkspaceView({ id }: { id: string }) {
  const [data, setData] = useState<SessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/workspaces/${id}/sessions`, { cache: "no-store" })
        if (!response.ok) {
          throw new Error(`Failed to load workspace (${response.status})`)
        }
        const body = (await response.json()) as SessionResponse
        if (!cancelled) {
          setData(body)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load workspace")
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  const createSession = async () => {
    if (!data) {
      return
    }
    try {
      const response = await fetch(`/api/workspaces/${id}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const body = (await response.json()) as { session?: { id: string }; openCodeUrl?: string }
      if (!response.ok) {
        throw new Error("Failed to create session")
      }
      if (body.openCodeUrl !== undefined) window.location.href = body.openCodeUrl
    } catch {
      setError("Could not create session")
    }
  }

  if (error !== null) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
        <p role="alert" className="text-error">
          {error}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:text-accent-hover">
          ← Back to workspaces
        </Link>
      </main>
    )
  }

  if (data === null) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
        <p className="text-muted" aria-live="polite">
          Loading workspace…
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <nav className="text-sm" aria-label="Breadcrumb">
        <Link href="/" className="text-accent hover:text-accent-hover">
          Workspaces
        </Link>
        <span className="mx-2 text-tertiary">/</span>
        <span className="text-muted">{data.workspace.repository}</span>
      </nav>

      <header className="mt-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {data.workspace.repository}
          </h1>
          <p className="mt-1 text-sm text-muted">
            branch {data.workspace.branch}
            {data.lastSessionID !== null ? " · last session active" : ""}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <a
            href={`/api/workspaces/${id}/open${data.lastSessionID === null ? "" : `?sessionId=${encodeURIComponent(data.lastSessionID)}`}`}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open OpenCode {data.lastSessionID === null ? "" : "session"} ↗
          </a>
          <button
            type="button"
            onClick={() => void createSession()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            New session
          </button>
        </div>
      </header>

      <section aria-labelledby="sessions-heading" className="mt-8">
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Sessions
        </h2>
        <p className="mt-1 text-sm text-muted">Sessions are managed by the official OpenCode Web UI.</p>

        {data.sessions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted">No sessions yet. Create your first session above.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {data.sessions.map((session) => {
              const active = session.id === data.lastSessionID
              return (
                <li key={session.id}>
                  <a
                    href={`/api/workspaces/${id}/open?sessionId=${encodeURIComponent(session.id)}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border bg-panel p-4 transition-colors duration-200 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
                      active ? "border-accent" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{session.title ?? session.id}</p>
                      <p className="mt-1 font-mono text-xs text-tertiary">{session.id}</p>
                      <p className="mt-1 text-xs text-tertiary">Updated {formatDate(session.updatedAt)}</p>
                    </div>
                  {active ? (
                    <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                      Last active
                    </span>
                  ) : null}
                    <span className="shrink-0 text-xs font-medium text-muted">Open ↗</span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
