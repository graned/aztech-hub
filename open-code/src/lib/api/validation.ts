import "server-only"
import { z } from "zod"
import { isGithubBranch, isGithubOwner, isGithubRepo } from "../github/client"
import { validationError } from "./http"

export const repositorySchema = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => {
    const [owner = "", name = ""] = value.split("/")
    return isGithubOwner(owner) && isGithubRepo(name)
  }, "repository must be owner/name of a valid GitHub repository")

export const branchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isGithubBranch, "invalid git branch name")

export const createWorkspaceSchema = z.object({
  repository: repositorySchema,
  branch: branchSchema,
})

export const workspaceIdSchema = z
  .string()
  .regex(/^ws-[a-f0-9]{12}$/, "invalid workspace id")

export const sessionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, "invalid session id")

export const promptSchema = z.object({
  text: z.string().trim().min(1).max(100_000, "prompt text is too long"),
})

export const searchRepositoriesSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export const ownerSchema = z
  .string()
  .min(1)
  .max(39)
  .refine(isGithubOwner, "invalid GitHub owner")

export const nameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isGithubRepo, "invalid GitHub repository name")

export interface ParseResult<T> {
  ok: true
  value: T
}

export interface ParseFailure {
  ok: false
  response: Response
}

export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): ParseResult<T> | ParseFailure {
  const result = schema.safeParse(body)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  return { ok: false, response: validationError(result.error) }
}

export function parseSearchParams<T>(schema: z.ZodType<T>, url: URL): ParseResult<T> | ParseFailure {
  const result = schema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (result.success) {
    return { ok: true, value: result.data }
  }
  return { ok: false, response: validationError(result.error) }
}