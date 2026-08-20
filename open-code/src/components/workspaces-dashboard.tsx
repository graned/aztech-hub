"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ClientGitHubBranch, ClientGitHubRepository, ClientWorkspace } from "@/lib/api/client-types"

interface WorkspacesResponse {
  workspaces: ClientWorkspace[]
}

interface SearchResponse {
  repositories: ClientGitHubRepository[]
  totalCount: number
}

interface SearchResultItem {
  fullName: string
  defaultBranch: string
  description: string | null
}

interface BranchesResponse {
  branches: ClientGitHubBranch[]
}

interface WorkspaceResponse {
  workspace: ClientWorkspace
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function WorkspacesDashboard() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<ClientWorkspace[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store" })
        if (!response.ok) {
          throw new Error(`Failed to load workspaces (${response.status})`)
        }
        const body = (await response.json()) as WorkspacesResponse
        if (!cancelled) {
          setWorkspaces(body.workspaces)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load workspaces")
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <span className="font-mono text-xs text-muted">Workspace Manager</span>
      </header>

      <section aria-labelledby="create-heading" className="mt-8 rounded-lg border bg-panel p-4 sm:p-6">
        <h2 id="create-heading" className="text-lg font-semibold">
          Create workspace
        </h2>
        <WorkspaceCreateForm
          onCreated={(workspace) => router.push(`/workspaces/${workspace.id}`)}
        />
      </section>

      <section aria-labelledby="list-heading" className="mt-8">
        <h2 id="list-heading" className="text-lg font-semibold">
          Existing workspaces
        </h2>

        {error !== null ? (
          <p role="alert" className="mt-4 text-error">
            {error}
          </p>
        ) : null}

        {workspaces === null && error === null ? (
          <p className="mt-4 text-muted" aria-live="polite">
            Loading workspaces…
          </p>
        ) : null}

        {workspaces !== null && workspaces.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted">No workspaces yet. Create your first one above.</p>
          </div>
        ) : null}

        {workspaces !== null && workspaces.length > 0 ? (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/workspaces/${workspace.id}`}
                  className="block rounded-lg border bg-panel p-4 transition-colors duration-200 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                >
                  <p className="truncate font-mono text-sm font-medium">{workspace.repository}</p>
                  <p className="mt-1 text-xs text-muted">branch {workspace.branch}</p>
                  <p className="mt-3 text-xs text-tertiary">
                    Updated {formatDate(workspace.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  )
}

function WorkspaceCreateForm({ onCreated }: { onCreated: (workspace: ClientWorkspace) => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResultItem[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchResultItem | null>(null)
  const [branches, setBranches] = useState<ClientGitHubBranch[] | null>(null)
  const [branch, setBranch] = useState("")
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const runSearch = async () => {
    const term = query.trim()
    if (term === "") {
      return
    }
    setResults(null)
    setSelected(null)
    setBranches(null)
    setSearchError(null)
    setSearching(true)
    try {
      const response = await fetch(`/api/github/search?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
      })
      const body = (await response.json()) as unknown
      if (!response.ok) {
        const err = body as ApiErrorBody
        setSearchError(err.error?.message ?? "Search failed")
        return
      }
      const parsed = body as SearchResponse
      setResults(
        parsed.repositories.map((repository) => ({
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          description: repository.description,
        })),
      )
    } catch {
      setSearchError("Could not reach the GitHub search endpoint")
    } finally {
      setSearching(false)
    }
  }

  const selectRepository = async (item: SearchResultItem) => {
    setSelected(item)
    setBranch(item.defaultBranch)
    setBranches(null)
    setSearchError(null)
    const [owner, repo] = item.fullName.split("/")
    if (owner === undefined || repo === undefined) {
      setBranches([])
      return
    }
    try {
      const response = await fetch(
        `/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
        { cache: "no-store" },
      )
      const body = (await response.json()) as unknown
      if (!response.ok) {
        const err = body as ApiErrorBody
        throw new Error(err.error?.message ?? "Failed to load branches")
      }
      const parsed = body as BranchesResponse
      setBranches(parsed.branches)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to load branches")
    }
  }

  const create = async () => {
    if (!selected) {
      return
    }
    if (branch.trim() === "") {
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository: selected.fullName, branch }),
      })
      const body = (await response.json()) as unknown
      if (!response.ok) {
        const err = body as ApiErrorBody
        setSubmitError(err.error?.message ?? "Failed to create workspace")
        return
      }
      const parsed = body as WorkspaceResponse
      onCreated(parsed.workspace)
    } catch {
      setSubmitError("Could not create workspace")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <label className="sr-only" htmlFor="repo-search">
          Search GitHub repositories
        </label>
        <input
          id="repo-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GitHub repositories…"
          className="min-w-0 flex-1 rounded-md border bg-panel px-3 py-2 text-sm text-foreground placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={searching || query.trim() === ""}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {searchError !== null ? (
        <p role="alert" className="text-sm text-error">
          {searchError}
        </p>
      ) : null}

      {results === null && !searching ? null : results !== null && results.length === 0 ? (
        <p className="text-sm text-muted">No repositories found.</p>
      ) : results !== null ? (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {results.map((item) => {
            const active = selected?.fullName === item.fullName
            return (
              <li key={item.fullName}>
                <button
                  type="button"
                  onClick={() => void selectRepository(item)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
                    active ? "bg-accent/10" : "hover:bg-background"
                  }`}
                >
                  <span className="truncate font-mono">{item.fullName}</span>
                  <span className="shrink-0 text-xs text-tertiary">{item.defaultBranch}</span>
                </button>
                {item.description !== null ? (
                  <p className="px-3 pb-2 text-xs text-tertiary">{item.description}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {selected !== null ? (
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">
            Repository: <span className="font-mono">{selected.fullName}</span>
          </p>
          <label className="mt-3 block text-sm" htmlFor="branch-select">
            Branch
          </label>
          <select
            id="branch-select"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            disabled={branches === null}
            className="mt-1 w-full rounded-md border bg-panel px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {branches === null ? (
              <option>Loading branches…</option>
            ) : branches.length === 0 ? (
              <option>No branches found</option>
            ) : (
              branches.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || branch === "" || branches === null}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>

          {submitError !== null ? (
            <p role="alert" className="mt-3 text-sm text-error">
              {submitError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
