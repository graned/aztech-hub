import "server-only"

export interface WorkspaceRecord {
  id: string
  repository: string
  branch: string
  directory: string
  createdAt: number
  updatedAt: number
  lastSessionID: string | null
}

export interface SessionMappingRecord {
  id: string
  workspaceID: string
  directory: string
  title?: string
  createdAt: number
  updatedAt: number
}

export class WorkspaceConflictError extends Error {
  readonly name = "WorkspaceConflictError"
  readonly kind = "workspace-conflict"
  constructor(
    public readonly repository: string,
    public readonly branch: string,
    public readonly directory: string,
  ) {
    super(`Workspace already exists for ${repository}@${branch} at ${directory}`)
  }
}

export class DuplicateKeyError extends Error {
  readonly name = "DuplicateKeyError"
}

export function workspaceIdFor(repository: string, branch: string, directory: string): string {
  const hash = hashString(`${repository}@${branch}@${directory}`).slice(0, 12)
  return `ws-${hash}`
}

function hashString(value: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < value.length; i++) {
    const ch = value.codePointAt(i)
    if (ch === undefined) {
      continue
    }
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")
}
