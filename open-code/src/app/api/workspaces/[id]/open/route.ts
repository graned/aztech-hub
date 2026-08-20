import { getApiServices } from "@/lib/api/services"
import { buildOpenCodeWebUrl } from "@/lib/opencode/web-url"
import { sessionIdSchema, workspaceIdSchema } from "@/lib/api/validation"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id: rawID } = await context.params
  const id = workspaceIdSchema.safeParse(rawID)
  if (!id.success) {
    return Response.json({ error: { code: "bad-request", message: "malformed workspace id" } }, { status: 400 })
  }

  const services = getApiServices()
  const workspace = await services.workspaceRepo.get(id.data)
  if (workspace === null) {
    return Response.json({ error: { code: "not-found", message: "workspace not found" } }, { status: 404 })
  }

  const sessionID = new URL(request.url).searchParams.get("sessionId")
  if (sessionID !== null) {
    const parsedSessionID = sessionIdSchema.safeParse(sessionID)
    if (!parsedSessionID.success) {
      return Response.json({ error: { code: "bad-request", message: "malformed session id" } }, { status: 400 })
    }
    const mapping = await services.sessionRepo.get(parsedSessionID.data)
    if (mapping === null || mapping.workspaceID !== id.data || mapping.directory !== workspace.directory) {
      return Response.json({ error: { code: "not-found", message: "session not found" } }, { status: 404 })
    }
    return Response.redirect(buildOpenCodeWebUrl(workspace.directory, mapping.id), 303)
  }

  return Response.redirect(buildOpenCodeWebUrl(workspace.directory), 303)
}

export const dynamic = "force-dynamic"
